// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Daily pipeline entry point (the daily workflow runs this, then commits
// the result + opens a PR or pushes to main per PUBLISH_MODE). Signing +
// upload happen in publish.yml when the change lands on main.
//
//   fetch (SSRF-safe, allowlisted) → distill → legal gate → dedup → cap
//   → lifecycle/snapshot → emit knowledge/*.md + feed-metadata.json
//
// Pure pipeline; no git/network side effects beyond fetch + distill.

import { join } from "node:path";
import { realFetchFn, fetchAllSources } from "./pipeline/fetch.js";
import { makeRealDistiller } from "./pipeline/distill.js";
import { checkEntry } from "./pipeline/legal.js";
import { loadSeen, isNew, updateSeen, saveSeen } from "./pipeline/dedup.js";
import { loadStore, applyToStore, saveStore } from "./pipeline/lifecycle.js";
import { emitBundleInput } from "./pipeline/emit.js";
import { resolvePublishPlan } from "./publish/mode.js";
import { SOURCES, MAX_ITEMS_PER_DAY } from "./config/sources.js";
import type { FeedEntry, RawItem } from "./types.js";
import type { Distiller } from "./pipeline/distill.js";
import type { FetchFn } from "./pipeline/fetch.js";
import type { SourceDef } from "./config/sources.js";

const SEEN_PATH = "state/seen.json";
const STORE_PATH = "state/store.json";

export interface RunDeps {
  fetchFn: FetchFn;
  distiller: Distiller;
  nowISO: string;
  rootDir: string;
  /** Override the source list (the round-trip test injects fixtures). */
  sources?: SourceDef[];
}

export interface RunResult {
  fetched: number;
  distilled: number;
  legalRejected: number;
  fresh: number;
  capped: number;
  snapshotSize: number;
  failures: { key: string; reason: string }[];
}

/** The pipeline as a pure-ish function so the round-trip test can drive it. */
export async function runPipeline(deps: RunDeps): Promise<RunResult> {
  const { fetchFn, distiller, nowISO, rootDir } = deps;
  const sources = deps.sources ?? SOURCES;

  const { items, failures } = await fetchAllSources(fetchFn, sources);

  const sourceByKey = new Map(sources.map((s) => [s.key, s]));
  const distilled: { entry: FeedEntry; raw: RawItem }[] = [];
  for (const raw of items) {
    const source = sourceByKey.get(raw.sourceKey)!;
    const entry = await distiller(raw, source);
    if (entry) distilled.push({ entry, raw });
  }

  // Legal gate (FR-9).
  let legalRejected = 0;
  const legal = distilled.filter(({ entry, raw }) => {
    const v = checkEntry(entry, raw, sourceByKey.get(raw.sourceKey)!);
    if (!v.ok) { legalRejected++; console.warn(`[legal] reject ${entry.id}: ${v.reason}`); }
    return v.ok;
  });

  // Dedup vs the rolling index.
  const seen = loadSeen(join(rootDir, SEEN_PATH));
  const fresh = legal.filter(({ entry }) => isNew(seen, entry.contentHash));

  // Cap new EVENT entries; foundational uncapped.
  const freshEvents = fresh.filter(({ entry }) => entry.tier === "event").slice(0, MAX_ITEMS_PER_DAY);
  const freshFoundational = fresh.filter(({ entry }) => entry.tier === "foundational");
  const capped = fresh.filter(({ entry }) => entry.tier === "event").length - freshEvents.length;
  const incoming = [...freshEvents, ...freshFoundational].map((x) => x.entry);

  // Lifecycle / snapshot.
  const store = loadStore(join(rootDir, STORE_PATH));
  const snapshot = applyToStore(store, incoming, nowISO);

  // Emit + persist state.
  emitBundleInput(snapshot, rootDir);
  saveStore(join(rootDir, STORE_PATH), snapshot);
  saveSeen(join(rootDir, SEEN_PATH), updateSeen(seen, incoming.map((e) => e.contentHash), nowISO));

  return {
    fetched: items.length,
    distilled: distilled.length,
    legalRejected,
    fresh: fresh.length,
    capped,
    snapshotSize: snapshot.length,
    failures,
  };
}

async function main() {
  const plan = resolvePublishPlan();
  if (plan.paused) {
    console.log("[run-daily] FEED_PAUSED — kill-switch active, no publishing.");
    return;
  }
  const result = await runPipeline({
    fetchFn: await realFetchFn(),
    distiller: makeRealDistiller(),
    nowISO: new Date().toISOString(),
    rootDir: ".",
  });
  console.log(`[run-daily] mode=${plan.mode} gitAction=${plan.gitAction}`);
  console.log(`[run-daily] ${JSON.stringify(result, null, 2)}`);
  if (result.failures.length) console.warn(`[run-daily] ${result.failures.length} source failures`);
}

// Only run when invoked directly (the round-trip test imports runPipeline).
if (process.argv[1] && process.argv[1].endsWith("run-daily.ts")) {
  main().catch((e) => { console.error("[run-daily] FAILED", e); process.exit(1); });
}
