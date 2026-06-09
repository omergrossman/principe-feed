// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Write the snapshot as a build-bundle input dir: one knowledge/<slug>.md
// per entry plus a feed-metadata.json (path → targeting metadata) that
// build-bundle merges into the signed manifest.

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { FeedEntry } from "../types.js";

/** id "knowledge:foo-bar" → file slug "foo-bar". */
function slugOf(id: string): string {
  return id.replace(/^knowledge:/, "");
}

export interface FeedMetaMap {
  [path: string]: { region?: string; industries?: string[]; category?: string; publishedAt?: string };
}

export function emitBundleInput(store: FeedEntry[], inputDir: string): { count: number } {
  const knowledgeDir = join(inputDir, "knowledge");
  rmSync(knowledgeDir, { recursive: true, force: true });
  mkdirSync(knowledgeDir, { recursive: true });

  const meta: FeedMetaMap = {};
  for (const e of store) {
    const slug = slugOf(e.id);
    const rel = `knowledge/${slug}.md`;
    // Human title lives in the content (the consumer's title is the slug).
    writeFileSync(join(inputDir, `${rel}`), `${e.title}\n\n${e.summary}\n`);
    meta[rel] = {
      region: e.region,
      industries: e.industries,
      category: e.category,
      publishedAt: e.publishedAt,
    };
  }
  writeFileSync(join(inputDir, "feed-metadata.json"), JSON.stringify(meta, null, 2) + "\n");
  return { count: store.length };
}
