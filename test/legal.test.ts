import { describe, it, expect } from "vitest";
import { checkEntry } from "../src/pipeline/legal.js";
import type { FeedEntry, RawItem } from "../src/types.js";
import type { SourceDef } from "../src/config/sources.js";

function entry(o: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id: "knowledge:x",
    tier: "foundational",
    category: "analyst",
    title: "Title",
    summary: "A measured paraphrase of a public announcement about new tooling.",
    sourceUrl: "https://example.com",
    publishedAt: "2026-01-01T00:00:00Z",
    contentHash: "h",
    ingestedAt: "2026-01-01T00:00:00Z",
    ...o,
  };
}
function raw(o: Partial<RawItem> = {}): RawItem {
  return {
    sourceKey: "k",
    url: "https://example.com",
    title: "Title",
    rawText: "Completely unrelated source body using entirely different vocabulary throughout.",
    publishedAt: null,
    ...o,
  };
}
// Loose override so tests can pass trust values outside the strict union.
function source(o: Record<string, unknown> = {}): SourceDef {
  return {
    key: "k",
    url: "https://example.com",
    defaultCategory: "analyst",
    tier: "foundational",
    trust: "public",
    ...o,
  } as unknown as SourceDef;
}

describe("checkEntry — FR-9 legal gate", () => {
  it("passes a clean foundational entry from a public source", () => {
    expect(checkEntry(entry(), raw(), source()).ok).toBe(true);
  });

  it("rejects foundational content from a non-public, non-manual source", () => {
    const v = checkEntry(entry(), raw(), source({ trust: "private" }));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/non-public/);
  });

  it("exempts manual (operator-added) sources from the public-source gate", () => {
    expect(checkEntry(entry(), raw(), source({ trust: "manual" })).ok).toBe(true);
  });

  it("does not apply the source gate to event-tier entries", () => {
    const v = checkEntry(
      entry({ tier: "event" }),
      raw(),
      source({ tier: "event", trust: "private" }),
    );
    expect(v.ok).toBe(true);
  });

  it("rejects an over-length summary", () => {
    expect(checkEntry(entry({ summary: "x".repeat(601) }), raw(), source()).ok).toBe(false);
  });

  it("rejects an empty summary", () => {
    const v = checkEntry(entry({ summary: "   " }), raw(), source());
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/empty/);
  });

  it("rejects a verbatim 10-word run shared with the source", () => {
    const run = "the threat actor exploited a misconfigured storage bucket to exfiltrate records";
    const v = checkEntry(
      entry({ summary: `Analysts note ${run}.` }),
      raw({ rawText: `In the report, ${run} over several weeks.` }),
      source(),
    );
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/verbatim/);
  });

  it("rejects high bag-of-words overlap even without a 10-word run", () => {
    const v = checkEntry(
      entry({ summary: "kappa lambda epsilon delta theta gamma" }),
      raw({ rawText: "alpha beta gamma delta epsilon zeta theta iota kappa lambda" }),
      source(),
    );
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/overlap/);
  });
});
