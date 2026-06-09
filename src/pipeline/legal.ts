// SPDX-License-Identifier: AGPL-3.0-or-later
//
// FR-9 legal safeguards — the Product Council sign-off condition. Three
// structural controls make auto-publishing analyst SUMMARIES defensible:
//   1. Public-source allowlist  (enforced in fetch.ts + here for tier).
//   2. Factual-summary length cap.
//   3. Programmatic verbatim reject — a summary sharing a long word-run
//      with the source text is rejected (no copy-paste of report body).

import type { FeedEntry, RawItem } from "../types.js";
import { SUMMARY_MAX_CHARS, VERBATIM_MAX_OVERLAP } from "../config/sources.js";
import type { SourceDef } from "../config/sources.js";

const SHINGLE_N = 10; // a shared run of 10+ words = verbatim copying

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

function shingles(tokens: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) out.add(tokens.slice(i, i + n).join(" "));
  return out;
}

/** Fraction of the summary's tokens that also appear anywhere in source. */
function tokenOverlap(summary: string, source: string): number {
  const st = words(summary);
  if (st.length === 0) return 0;
  const src = new Set(words(source));
  let hit = 0;
  for (const t of st) if (t.length > 3 && src.has(t)) hit++;
  return hit / st.length;
}

export interface LegalVerdict {
  ok: boolean;
  reason?: string;
}

export function checkEntry(entry: FeedEntry, raw: RawItem, source: SourceDef): LegalVerdict {
  // 1. Tier/source gate: scraped foundational content must be a public
  //    surface. Operator-added (`manual`) content is exempt — it's their own
  //    material — but is still digested + verbatim-checked below.
  if (entry.tier === "foundational" && source.trust !== "public" && source.trust !== "manual") {
    return { ok: false, reason: "foundational entry from non-public source" };
  }
  // 2. Length cap.
  if (entry.summary.length > SUMMARY_MAX_CHARS) {
    return { ok: false, reason: `summary over ${SUMMARY_MAX_CHARS} chars` };
  }
  if (entry.summary.trim().length === 0) {
    return { ok: false, reason: "empty summary" };
  }
  // 3a. Verbatim run: any shared 10-word shingle = copy-paste → reject.
  const shared = shingles(words(entry.summary), SHINGLE_N);
  if (shared.size > 0) {
    const srcShingles = shingles(words(raw.rawText), SHINGLE_N);
    for (const sh of shared) {
      if (srcShingles.has(sh)) {
        return { ok: false, reason: "verbatim run shared with source" };
      }
    }
  }
  // 3b. Coarse bag-of-words overlap backstop (catches near-verbatim that
  // dodges the shingle test by light edits).
  if (tokenOverlap(entry.summary, raw.rawText) >= VERBATIM_MAX_OVERLAP) {
    return { ok: false, reason: `token overlap ≥ ${VERBATIM_MAX_OVERLAP}` };
  }
  return { ok: true };
}
