// SPDX-License-Identifier: AGPL-3.0-or-later

/** A raw item pulled from a source before distillation. */
export interface RawItem {
  /** Config source key this came from. */
  sourceKey: string;
  url: string;
  title: string;
  /** Cleaned page/article text (SSRF-safe fetch already applied). */
  rawText: string;
  publishedAt: string | null; // ISO, if the source reported one
}

export type Tier = "event" | "foundational";

/**
 * A distilled, publishable feed entry. Maps onto the consumer's bundle
 * entry + KnowledgeSource row. `id` is the stable bundle id
 * (`knowledge:<slug>`); supersession re-uses the id for a given subjectKey.
 */
export interface FeedEntry {
  id: string;
  tier: Tier;
  category: string; // attack | threat-intel | strategy | product-release | regulation | news | analyst
  region?: string; // global | us | eu-west | uk | eu-central | apac | anz | mea
  industries?: string[]; // e.g. ["healthcare"]
  title: string;
  summary: string; // 2–3 factual sentences
  sourceUrl: string;
  publishedAt: string; // ISO
  contentHash: string; // sha256 of the source text — dedup key
  // Foundational-only lifecycle:
  subjectKey?: string; // stable domain key, e.g. "gartner-mq-endpoint"
  reportDate?: string; // ISO — newer supersedes older for the same subjectKey
  // Producer bookkeeping (not shipped to the consumer):
  ingestedAt: string; // ISO — when first added; drives event TTL
}
