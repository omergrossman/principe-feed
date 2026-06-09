// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Source ingestion. Each source is an RSS/Atom feed; we parse it into
// INDIVIDUAL articles (not one blob) so (a) dedup is stable per article
// and (b) the whole feed's diversity — regulation, strategy, analyst,
// not just the lead incident — flows downstream. Hosts are constrained to
// the curated allowlist (the producer never fetches a user-supplied URL),
// which is the SSRF boundary on the producer side.

import crypto from "node:crypto";
import Parser from "rss-parser";
import type { RawItem } from "../types.js";
import { ALLOWED_HOSTS, SOURCES, type SourceDef } from "../config/sources.js";

/** Pull one source into its recent articles. Injected so tests use fixtures. */
export type IngestFn = (source: SourceDef) => Promise<RawItem[]>;

const MAX_ITEMS_PER_SOURCE = 12; // recent articles to consider per feed/run

export function assertAllowedHost(url: string): void {
  const host = new URL(url).host;
  if (!ALLOWED_HOSTS.has(host)) throw new Error(`host not in source allowlist: ${host}`);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

export const sha = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

/** Production ingester — RSS/Atom via rss-parser, with a browser-ish UA. */
export function makeRssIngest(): IngestFn {
  const parser = new Parser({
    timeout: 20_000, // some regulator feeds (ACSC) are slow
    // Browser-like UA — several feeds (e.g. analyst sites) 403 a "bot" UA.
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
    },
  });
  return async (source) => {
    assertAllowedHost(source.url);
    const feed = await parser.parseURL(source.url);
    return (feed.items ?? [])
      .slice(0, MAX_ITEMS_PER_SOURCE)
      .map((it): RawItem | null => {
        const title = (it.title ?? "").trim();
        const body = stripHtml(it.contentSnippet ?? it.content ?? (it as { summary?: string }).summary ?? "");
        const url = it.link ?? it.guid ?? "";
        if (!title || !url) return null;
        return {
          sourceKey: source.key,
          url,
          title,
          rawText: body || title,
          publishedAt: it.isoDate ?? null,
        };
      })
      .filter((r): r is RawItem => r !== null);
  };
}

/** Pull every configured source into a flat RawItem[] (+ per-source failures). */
export async function fetchAllSources(
  ingest: IngestFn,
  sources: SourceDef[] = SOURCES,
): Promise<{ items: RawItem[]; failures: { key: string; reason: string }[] }> {
  const items: RawItem[] = [];
  const failures: { key: string; reason: string }[] = [];
  for (const s of sources) {
    try {
      const got = await ingest(s);
      if (got.length === 0) failures.push({ key: s.key, reason: "no items" });
      else items.push(...got);
    } catch (e) {
      failures.push({ key: s.key, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { items, failures };
}
