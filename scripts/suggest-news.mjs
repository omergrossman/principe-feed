#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// suggest-news — drafts candidate news updates from recent product changes
// (merged PRs in the principe-oss repo) using the feed's Anthropic key, and
// writes them to news/suggestions.json for review in the Console.
//
// Runs in CI (has ANTHROPIC_API_KEY + a token); triggered by the Console's
// "Suggest" button (workflow_dispatch) or a weekly schedule. It only writes
// when there's something genuinely worth announcing — otherwise it no-ops.
//
//   ANTHROPIC_API_KEY=… GITHUB_TOKEN=… node scripts/suggest-news.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ITEMS = join(ROOT, "news", "items.json");
const SUGGEST = join(ROOT, "news", "suggestions.json");
const SRC_REPO = process.env.SUGGEST_REPO || "omergrossman/principe-oss";
const LOOKBACK_DAYS = Number(process.env.SUGGEST_LOOKBACK_DAYS || 45);
const MAX_SUGGESTIONS = 8;
const TAGS = new Set(["feature", "calibration", "security", "release", "research", "tip"]);

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.log("No ANTHROPIC_API_KEY — skipping suggestion draft."); process.exit(0); }

const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : []; } catch { return []; } };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "update";
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// --- recent merged PRs from the product repo ---
async function recentChanges() {
  const r = await fetch(`https://api.github.com/repos/${SRC_REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=50`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "principe-feed-suggest", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
  });
  if (!r.ok) throw new Error(`GitHub PRs ${r.status}`);
  const cutoff = Date.now() - LOOKBACK_DAYS * 86400000;
  return (await r.json())
    .filter((p) => p.merged_at && new Date(p.merged_at).getTime() >= cutoff)
    .map((p) => ({ title: p.title, body: (p.body || "").slice(0, 600), at: p.merged_at.slice(0, 10) }));
}

// --- Anthropic draft ---
function parseItems(text) {
  let t = text.replace(/```json\s*|\s*```/g, "").trim();
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try { const j = JSON.parse(t); return Array.isArray(j) ? j : []; } catch { return []; }
}
async function draft(changes, publishedTitles) {
  const prompt = `You write short product-update news for Príncipe, an open-source synthetic-CISO-panel platform.
From these recently merged pull requests, draft news updates for users — only genuinely user-noticeable changes (new capability, calibration/accuracy, security, releases). SKIP internal refactors, chores, CI, docs-only, and anything cosmetic.

Recently merged PRs:
${changes.map((c) => `- (${c.at}) ${c.title}${c.body ? `\n    ${c.body.replace(/\n/g, " ").slice(0, 240)}` : ""}`).join("\n")}

Already published (do NOT repeat these):
${publishedTitles.map((t) => `- ${t}`).join("\n") || "- (none)"}

Return ONLY a JSON array (no prose) of up to 4 items, each:
{"tag":"feature|calibration|security|release|research|tip","channel":"both","title":"…","summary":"one line","body":"2–4 sentences, plain, markdown ok"}
If nothing is worth announcing, return [].`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return parseItems(j?.content?.[0]?.text || "");
}

(async () => {
  const changes = await recentChanges();
  if (!changes.length) { console.log("No recent merged PRs — nothing to suggest."); process.exit(0); }

  const items = readJson(ITEMS), existingSug = readJson(SUGGEST);
  const publishedTitles = items.map((x) => x.title);
  const taken = new Set([...items, ...existingSug].map((x) => norm(x.title)));
  const ids = new Set([...items, ...existingSug].map((x) => x.id));
  const today = new Date().toISOString().slice(0, 10);

  const drafted = await draft(changes, publishedTitles);
  const fresh = [];
  for (const d of drafted) {
    if (!d || !d.title || !d.body || !TAGS.has(d.tag)) continue;
    if (taken.has(norm(d.title))) continue;
    taken.add(norm(d.title));
    let base = slug(d.title), id = base, n = 2;
    while (ids.has(id)) id = `${base}-${n++}`;
    ids.add(id);
    fresh.push({ id, date: today, tag: d.tag, channel: ["app", "web", "both"].includes(d.channel) ? d.channel : "both", title: d.title.trim(), summary: (d.summary || "").trim(), body: d.body.trim(), why: "Drafted from a recent product change." });
  }

  if (!fresh.length) { console.log("Nothing new worth suggesting."); process.exit(0); }
  const merged = [...fresh, ...existingSug].slice(0, MAX_SUGGESTIONS);
  writeFileSync(SUGGEST, JSON.stringify(merged, null, 2) + "\n");
  console.log(`✓ ${fresh.length} new suggestion(s); ${merged.length} pending.`);
})().catch((e) => { console.error("suggest-news failed:", e.message); process.exit(1); });
