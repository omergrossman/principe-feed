// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Feed distiller: raw item → a factual, non-sensational FeedEntry. The
// consumer's briefing renders these as ranked reference material, so the
// tone instruction is "balanced, never alarmist" (FR-17).
//
// Two implementations behind one seam:
//   - realDistiller  — Anthropic (claude-haiku-4-5), used in production.
//   - stubDistiller  — deterministic, no network/key. Used by the
//     round-trip verification and as a fallback when no API key is set.

import crypto from "node:crypto";
import type { RawItem, FeedEntry, Tier } from "../types.js";
import type { SourceDef } from "../config/sources.js";
import { SUMMARY_MAX_CHARS } from "../config/sources.js";

export type Distiller = (raw: RawItem, source: SourceDef) => Promise<FeedEntry | null>;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// Minimal industry keyword routing for the stub. The real distiller lets
// the model assign industries; absence = a general entry.
const INDUSTRY_KEYWORDS: Record<string, string> = {
  health: "healthcare", hospital: "healthcare", patient: "healthcare",
  bank: "financial-services", financial: "financial-services", fintech: "financial-services",
  energy: "energy", utility: "energy", grid: "energy",
  retail: "retail", manufactur: "manufacturing", government: "government",
};

function inferIndustries(text: string): string[] | undefined {
  const t = text.toLowerCase();
  const hit = new Set<string>();
  for (const [kw, ind] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (t.includes(kw)) hit.add(ind);
  }
  return hit.size ? [...hit] : undefined;
}

/**
 * Build the common parts of a FeedEntry (id, lifecycle keys) for a tier.
 * Foundational entries get a STABLE subjectKey/id so a newer report
 * supersedes the older one in place; events get a content-unique id.
 */
function baseEntry(
  raw: RawItem,
  source: SourceDef,
  fields: { title: string; summary: string; category: string; region?: string; industries?: string[] },
): FeedEntry {
  const tier: Tier = source.tier;
  const contentHash = sha256(raw.rawText);
  const publishedAt = raw.publishedAt ?? new Date().toISOString();
  if (tier === "foundational") {
    // Stable subject. Analyst sources key by source+category domain (e.g.
    // "gartner-newsroom-analyst") so a new report supersedes the old. Manual
    // items key PER-ITEM (by link/file) so each persists independently and
    // re-adding the same one updates it.
    const subjectKey =
      source.key === "manual"
        ? `manual-${sha256(raw.url).slice(0, 12)}`
        : `${source.key}-${slugify(fields.category)}`;
    return {
      id: `knowledge:${subjectKey}`,
      tier, category: fields.category, region: fields.region, industries: fields.industries,
      title: fields.title, summary: fields.summary, sourceUrl: raw.url, publishedAt,
      contentHash, subjectKey, reportDate: publishedAt, ingestedAt: new Date().toISOString(),
    };
  }
  // Event id is STABLE per article (hash of the link), so the same story
  // never re-adds as a near-duplicate when the feed shifts during the day.
  return {
    id: `knowledge:${source.key}-${sha256(raw.url).slice(0, 10)}`,
    tier, category: fields.category, region: fields.region, industries: fields.industries,
    title: fields.title, summary: fields.summary, sourceUrl: raw.url, publishedAt,
    contentHash, ingestedAt: new Date().toISOString(),
  };
}

/** Deterministic, network-free distiller. Produces a low-verbatim summary. */
export const stubDistiller: Distiller = async (raw, source) => {
  // Summary framed from the TITLE + a factual scaffold (deliberately not
  // copied from the body) so it stays well under the verbatim threshold.
  const summary =
    `Reported via ${source.key}: ${raw.title}. Tracked as ${source.defaultCategory} relevant to security prioritisation.`
      .slice(0, SUMMARY_MAX_CHARS);
  return baseEntry(raw, source, {
    title: raw.title,
    summary,
    category: source.defaultCategory,
    region: source.region,
    industries: inferIndustries(`${raw.title} ${raw.rawText}`),
  });
};

const DISTILL_PROMPT = `You summarize cybersecurity news for a panel of synthetic CISOs.
Return STRICT JSON only: { "title": string, "summary": string, "category": one of [attack, threat-intel, strategy, product-release, regulation, news, analyst], "region": one of [global, us, eu-west, uk, eu-central, apac, anz, mea] or null, "industries": string[] (lowercased sectors, or []) }.
Rules:
- summary: 2-3 FACTUAL sentences, <= ${SUMMARY_MAX_CHARS} chars. Paraphrase — never copy sentences verbatim from the source.
- Tone: measured and analytical. NEVER alarmist; no "urgent"/"breaking"/"act now".
- region/industries: set ONLY when the item is genuinely specific to them; otherwise null/[].
- For analyst/foundational sources: summarize the PUBLIC announcement only; do not reproduce any report body.
Output JSON only, no markdown fence.`;

/** Anthropic-backed distiller. Falls back to stub if no key configured. */
export function makeRealDistiller(): Distiller {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return stubDistiller;
  return async (raw, source) => {
    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 500,
          messages: [{ role: "user", content: `${DISTILL_PROMPT}\n\nSOURCE: ${source.key}\nTITLE: ${raw.title}\nTEXT:\n${raw.rawText.slice(0, 6000)}` }],
        }),
        // Hard timeout so one stalled request can't hang the whole sequential run.
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      console.warn(`[distill] request failed/timed out (${source.key}): ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    if (!res.ok) {
      console.warn(`[distill] Anthropic ${res.status} (${source.key}) — ${(await res.text()).slice(0, 140)}`);
      return null;
    }
    const data = (await res.json()) as { content?: { text?: string }[] };
    const text = data.content?.[0]?.text ?? "";
    let parsed: { title: string; summary: string; category: string; region: string | null; industries: string[] };
    try {
      parsed = JSON.parse(text.replace(/^```json?\s*|\s*```$/g, "").trim());
    } catch {
      return null;
    }
    return baseEntry(raw, source, {
      title: parsed.title || raw.title,
      summary: (parsed.summary || "").slice(0, SUMMARY_MAX_CHARS),
      category: parsed.category || source.defaultCategory,
      region: parsed.region ?? source.region,
      industries: parsed.industries?.length ? parsed.industries : undefined,
    });
  };
}
