// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Two-tier lifecycle + snapshot. The producer keeps a persistent store of
// the current live entries; each run merges new entries, expires old
// events, supersedes foundational reports, and emits the FULL current set
// as the bundle (the consumer's apply is snapshot-based — absent = removed).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { FeedEntry } from "../types.js";
import { TTL_DAYS } from "../config/sources.js";

export function loadStore(path: string): FeedEntry[] {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FeedEntry[];
  } catch {
    return [];
  }
}

export function saveStore(path: string, store: FeedEntry[]): void {
  writeFileSync(path, JSON.stringify(store, null, 2) + "\n");
}

/**
 * Merge new entries into the store, then expire stale events. Returns the
 * new store = the snapshot to publish.
 *   - event:        added if its id isn't already present.
 *   - foundational: replaces the same-subjectKey entry IFF the new
 *                   reportDate is strictly newer; a same/older report is
 *                   skipped (no downgrade, no duplicate).
 *   - expiry:       events whose ingestedAt is older than TTL_DAYS drop.
 *                   foundational entries never expire.
 */
export function applyToStore(store: FeedEntry[], incoming: FeedEntry[], nowISO: string): FeedEntry[] {
  const byId = new Map(store.map((e) => [e.id, e]));
  const bySubject = new Map(store.filter((e) => e.subjectKey).map((e) => [e.subjectKey!, e]));

  // applyToStore is authoritative for ingestedAt — it stamps the run's
  // clock on first insert (so TTL is driven by when the PRODUCER first saw
  // the item, deterministically), and preserves it across supersession.
  for (const entry of incoming) {
    if (entry.tier === "foundational" && entry.subjectKey) {
      const prev = bySubject.get(entry.subjectKey);
      if (prev) {
        const prevDate = new Date(prev.reportDate ?? prev.publishedAt).getTime();
        const newDate = new Date(entry.reportDate ?? entry.publishedAt).getTime();
        if (newDate > prevDate) {
          // Supersede in place — same id (derived from subjectKey); keep the
          // original ingestedAt so foundational persistence is unbroken.
          const merged = { ...entry, ingestedAt: prev.ingestedAt };
          byId.set(merged.id, merged);
          bySubject.set(entry.subjectKey, merged);
        }
        // else: same/older report → skip.
      } else {
        const fresh = { ...entry, ingestedAt: nowISO };
        byId.set(fresh.id, fresh);
        bySubject.set(entry.subjectKey, fresh);
      }
      continue;
    }
    // event — add if unseen by id.
    if (!byId.has(entry.id)) byId.set(entry.id, { ...entry, ingestedAt: nowISO });
  }

  const cutoff = new Date(nowISO).getTime() - TTL_DAYS * 86_400_000;
  return [...byId.values()].filter((e) => {
    if (e.tier === "foundational") return true; // never expires
    return new Date(e.ingestedAt).getTime() >= cutoff;
  });
}
