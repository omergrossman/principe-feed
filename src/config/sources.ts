// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The curated source allowlist + pipeline tunables. This is the ONLY
// place sources are defined — the fetcher refuses any URL not derived
// from a source listed here, which is also the legal allowlist gate for
// foundational/analyst content (FR-9): the pipeline structurally cannot
// reach a paywalled report because it only visits these hosts.

export interface SourceDef {
  key: string;
  /** Feed/page URL to pull (RSS preferred). */
  url: string;
  /** Default category for items from this source (the distiller may refine). */
  defaultCategory: string;
  /** Default tier. Analyst/foundational sources are PUBLIC surfaces only. */
  tier: "event" | "foundational";
  /** Optional default region tag. */
  region?: string;
  /**
   * `public` = an allowlisted public surface, safe for foundational/analyst
   * summaries (vendor "named a Leader" pages, public analyst summaries,
   * press releases). Foundational entries MUST come from a `public` source.
   */
  trust: "public";
}

export const SOURCES: SourceDef[] = [
  { key: "cisa", url: "https://www.cisa.gov/cybersecurity-advisories/all.xml", defaultCategory: "regulation", tier: "event", region: "us", trust: "public" },
  { key: "krebs", url: "https://krebsonsecurity.com/feed/", defaultCategory: "attack", tier: "event", trust: "public" },
  { key: "bleeping", url: "https://www.bleepingcomputer.com/feed/", defaultCategory: "threat-intel", tier: "event", trust: "public" },
  { key: "thehackernews", url: "https://feeds.feedburner.com/TheHackersNews", defaultCategory: "threat-intel", tier: "event", trust: "public" },
  { key: "darkreading", url: "https://www.darkreading.com/rss.xml", defaultCategory: "strategy", tier: "event", trust: "public" },
  { key: "sans-isc", url: "https://isc.sans.edu/rssfeed_full.xml", defaultCategory: "threat-intel", tier: "event", trust: "public" },
  { key: "ncsc-uk", url: "https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml", defaultCategory: "regulation", tier: "event", region: "uk", trust: "public" },
  { key: "acsc-anz", url: "https://www.cyber.gov.au/rss/alerts", defaultCategory: "regulation", tier: "event", region: "anz", trust: "public" },
  // Foundational — PUBLIC analyst surfaces only (summaries / "named a Leader"
  // announcements / press releases). Never paywalled report URLs.
  { key: "gartner-newsroom", url: "https://www.gartner.com/en/newsroom/rss", defaultCategory: "analyst", tier: "foundational", trust: "public" },
];

export const ALLOWED_HOSTS: Set<string> = new Set(
  SOURCES.map((s) => new URL(s.url).host),
);

// Pipeline tunables (overridable via env in the Action).
export const TTL_DAYS = Number(process.env.FEED_TTL_DAYS ?? 30); // event tier only
export const MAX_ITEMS_PER_DAY = Number(process.env.FEED_MAX_ITEMS ?? 20); // new event entries/run
export const SUMMARY_MAX_CHARS = Number(process.env.FEED_SUMMARY_MAX ?? 600); // legal length cap
export const VERBATIM_MAX_OVERLAP = Number(process.env.FEED_VERBATIM_MAX ?? 0.5); // ≥ this token overlap w/ source = reject
