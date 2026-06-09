// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fetch seam. The SSRF-safe fetcher is REUSED from principe-oss (the
// submodule), never reimplemented — `fetchUrlAsText` re-runs the SSRF
// guard on every redirect hop. We depend on it through this seam so the
// pipeline is testable with fixtures and the security primitive stays
// single-sourced (ADR decision).

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RawItem } from "../types.js";
import { ALLOWED_HOSTS, SOURCES, type SourceDef } from "../config/sources.js";

/** Fetch one source URL → cleaned text. Injected so tests use fixtures. */
export type FetchFn = (url: string) => Promise<{
  text: string;
  contentHash: string;
  title: string | null;
  publishedAt: Date | null;
}>;

/**
 * Production adapter — lazily imports the submoduled SSRF-safe fetcher.
 * PRINCIPE_OSS_DIR points at the principe-oss checkout (a git submodule
 * in CI; the sibling repo locally).
 */
export async function realFetchFn(): Promise<FetchFn> {
  const dir = process.env.PRINCIPE_OSS_DIR ?? "../principe-oss";
  // Resolve to an absolute file:// URL — a bare/relative specifier like
  // "vendor/principe-oss/..." would be read as a package name by Node's
  // ESM resolver.
  const target = pathToFileURL(resolve(dir, "apps/principe/src/lib/sources/fetch.ts")).href;
  const mod = await import(target);
  return mod.fetchUrlAsText as FetchFn;
}

/** Allowlist gate — refuse any host not derived from the source config. */
export function assertAllowedHost(url: string): void {
  const host = new URL(url).host;
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`host not in source allowlist: ${host}`);
  }
}

/**
 * Pull every configured source into RawItems. One item per source here
 * (the source URL is treated as the article); a real RSS parser would
 * expand each feed into N items — that refinement is isolated to this
 * function and doesn't touch the rest of the pipeline.
 */
export async function fetchAllSources(
  fetchFn: FetchFn,
  sources: SourceDef[] = SOURCES,
): Promise<{ items: RawItem[]; failures: { key: string; reason: string }[] }> {
  const items: RawItem[] = [];
  const failures: { key: string; reason: string }[] = [];
  for (const s of sources) {
    try {
      assertAllowedHost(s.url);
      const r = await fetchFn(s.url);
      if (!r.text || r.text.trim().length === 0) {
        failures.push({ key: s.key, reason: "empty fetch" });
        continue;
      }
      items.push({
        sourceKey: s.key,
        url: s.url,
        title: r.title ?? s.key,
        rawText: r.text,
        publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      });
    } catch (e) {
      failures.push({ key: s.key, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { items, failures };
}
