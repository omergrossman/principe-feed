// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Rolling dedup index — a committed JSON file (diffable, shows up in the
// review-mode PR). Maps source contentHash → first-seen date so an item
// already published isn't re-added even after it expires out of the live
// store. Pruned past a retention window to bound growth.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const RETENTION_DAYS = 90;

export type SeenIndex = Record<string, string>; // contentHash -> ISO first-seen

export function loadSeen(path: string): SeenIndex {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SeenIndex;
  } catch {
    return {};
  }
}

export function isNew(seen: SeenIndex, contentHash: string): boolean {
  return !(contentHash in seen);
}

/** Record new hashes and prune entries past the retention window. */
export function updateSeen(seen: SeenIndex, hashes: string[], nowISO: string): SeenIndex {
  const next: SeenIndex = { ...seen };
  for (const h of hashes) if (!(h in next)) next[h] = nowISO;
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  for (const [h, iso] of Object.entries(next)) {
    if (new Date(iso).getTime() < cutoff) delete next[h];
  }
  return next;
}

export function saveSeen(path: string, seen: SeenIndex): void {
  writeFileSync(path, JSON.stringify(seen, null, 2) + "\n");
}
