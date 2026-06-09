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
import { makeRssIngest, fetchAllSources, makeRealUrlFetch } from "./pipeline/fetch.js";
import { loadManualItems, archiveProcessed, type ManualUrlFetch } from "./pipeline/manual.js";
import { makeRealDistiller } from "./pipeline/distill.js";
import { checkEntry } from "./pipeline/legal.js";
import { loadSeen, isNew, updateSeen, saveSeen } from "./pipeline/dedup.js";
import { loadStore, applyToStore, saveStore } from "./pipeline/lifecycle.js";
import { emitBundleInput } from "./pipeline/emit.js";
import { resolvePublishPlan } from "./publish/mode.js";
import { SOURCES, MAX_ITEMS_PER_DAY, MANUAL_SOURCE } from "./config/sources.js";
import type { FeedEntry, RawItem } from "./types.js";
import type { Distiller } from "./pipeline/distill.js";
import type { IngestFn } from "./pipeline/fetch.js";
import type { SourceDef } from "./config/sources.js";

const SEEN_PATH = "state/seen.json";
const STORE_PATH = "state/store.json";

export interface RunDeps {
  ingest: IngestFn;
  distiller: Distiller;
  nowISO: string;
  rootDir: string;
  /** Override the source list (the round-trip test injects fixtures). */
  sources?: SourceDef[];
  /** Single-URL fetch for operator-added manual URLs (prod injects the
   * submoduled SSRF fetcher; tests can omit it — no manual/ dir = no calls). */
  manualFetch?: ManualUrlFetch;
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
  const { ingest, distiller, nowISO, rootDir } = deps;
  const sources = deps.sources ?? SOURCES;
  const sourceByKey = new Map([...sources, MANUAL_SOURCE].map((s) => [s.key, s]));

  // 1. Ingest RSS sources into individual articles.
  const { items: rssItems, failures: rssFailures } = await fetchAllSources(ingest, sources);

  const seen = loadSeen(join(rootDir, SEEN_PATH));

  // 1b. Operator-added URLs/files — digested into the package (key points,
  //     never verbatim). Skip URLs already digested; processed inbox files
  //     are archived after a successful build.
  const manual = deps.manualFetch
    ? await loadManualItems(rootDir, deps.manualFetch, (k) => !isNew(seen, k))
    : { items: [], processedFiles: [], failures: [] };
  const items = [...rssItems, ...manual.items];
  const failures = [...rssFailures, ...manual.failures];

  // 2. Dedup by stable article link BEFORE distilling (saves LLM calls and
  //    is what prevents the same story re-appearing as the feed shifts).
  const freshRaw = items.filter((r) => isNew(seen, r.url));

  // 3. Cap new EVENT articles per run, ROUND-ROBIN across sources so one
  //    prolific feed (e.g. CISA's advisory firehose) can't crowd out
  //    regulation/strategy/analyst items from quieter feeds. Foundational
  //    is uncapped.
  const isEvent = (r: RawItem) => sourceByKey.get(r.sourceKey)!.tier === "event";
  const freshEvents = freshRaw.filter(isEvent);
  const queues = new Map<string, RawItem[]>();
  for (const r of freshEvents) {
    const q = queues.get(r.sourceKey) ?? [];
    q.push(r);
    queues.set(r.sourceKey, q);
  }
  const lanes = [...queues.values()];
  const pickedEvents: RawItem[] = [];
  for (let round = 0; pickedEvents.length < MAX_ITEMS_PER_DAY && lanes.some((q) => q.length); round++) {
    for (const q of lanes) {
      if (pickedEvents.length >= MAX_ITEMS_PER_DAY) break;
      const item = q.shift();
      if (item) pickedEvents.push(item);
    }
  }
  const toProcess = [...pickedEvents, ...freshRaw.filter((r) => !isEvent(r))];
  const capped = freshEvents.length - pickedEvents.length;

  // 4. Distill each fresh article.
  const distilled: { entry: FeedEntry; raw: RawItem }[] = [];
  for (const raw of toProcess) {
    const entry = await distiller(raw, sourceByKey.get(raw.sourceKey)!);
    if (entry) distilled.push({ entry, raw });
  }

  // 5. Legal gate (FR-9).
  let legalRejected = 0;
  const legal = distilled.filter(({ entry, raw }) => {
    const v = checkEntry(entry, raw, sourceByKey.get(raw.sourceKey)!);
    if (!v.ok) { legalRejected++; console.warn(`[legal] reject ${entry.id}: ${v.reason}`); }
    return v.ok;
  });
  const incoming = legal.map((x) => x.entry);

  // 6. Lifecycle / snapshot.
  const store = loadStore(join(rootDir, STORE_PATH));
  const snapshot = applyToStore(store, incoming, nowISO);

  // 7. Emit + persist. Mark every ATTEMPTED article seen (incl. legal/distill
  //    failures) so we don't re-process them daily.
  emitBundleInput(snapshot, rootDir);
  saveStore(join(rootDir, STORE_PATH), snapshot);
  saveSeen(join(rootDir, SEEN_PATH), updateSeen(seen, toProcess.map((r) => r.url), nowISO));
  archiveProcessed(rootDir, manual.processedFiles); // move ingested files out of the inbox

  return {
    fetched: items.length,
    distilled: distilled.length,
    legalRejected,
    fresh: freshRaw.length,
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
    ingest: makeRssIngest(),
    distiller: makeRealDistiller(),
    manualFetch: await makeRealUrlFetch(),
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
