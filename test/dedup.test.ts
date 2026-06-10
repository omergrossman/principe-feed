import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, writeFileSync } from "node:fs";
import { loadSeen, isNew, updateSeen, saveSeen } from "../src/pipeline/dedup.js";

const tmp = () => join(tmpdir(), `seen-${Math.random().toString(36).slice(2)}.json`);

describe("dedup", () => {
  it("isNew: true for unseen keys, false for seen", () => {
    const seen = { a: "2026-01-01T00:00:00Z" };
    expect(isNew(seen, "b")).toBe(true);
    expect(isNew(seen, "a")).toBe(false);
  });

  it("updateSeen adds new keys but preserves existing first-seen timestamps", () => {
    // Use a recent first-seen so the retention prune doesn't drop it.
    const firstSeen = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const now = new Date().toISOString();
    const next = updateSeen({ a: firstSeen }, ["a", "b"], now);
    expect(next.a).toBe(firstSeen); // re-adding "a" must NOT overwrite its first-seen
    expect(next.b).toBe(now); // "b" is new
  });

  it("updateSeen prunes entries past the 90-day retention window", () => {
    const stale = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const fresh = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const next = updateSeen({ stale, fresh }, [], new Date().toISOString());
    expect("stale" in next).toBe(false);
    expect("fresh" in next).toBe(true);
  });

  it("loadSeen returns {} for a missing file", () => {
    expect(loadSeen(tmp())).toEqual({});
  });

  it("loadSeen returns {} for a corrupt file", () => {
    const p = tmp();
    writeFileSync(p, "{ not valid json");
    try {
      expect(loadSeen(p)).toEqual({});
    } finally {
      rmSync(p, { force: true });
    }
  });

  it("saveSeen + loadSeen round-trip", () => {
    const p = tmp();
    try {
      const data = { x: "2026-06-01T00:00:00Z" };
      saveSeen(p, data);
      expect(loadSeen(p)).toEqual(data);
    } finally {
      rmSync(p, { force: true });
    }
  });
});
