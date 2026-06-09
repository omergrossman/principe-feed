// SPDX-License-Identifier: AGPL-3.0-or-later
// Verifies operator-added URLs/files are digested into the package,
// persist, are moved out of the inbox, and don't duplicate on re-run.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/run-daily.js";
import { stubDistiller } from "../src/pipeline/distill.js";
import type { FeedEntry } from "../src/types.js";

let passed = 0;
function check(l: string, c: boolean) { if (!c) throw new Error(`FAIL: ${l}`); passed++; console.log(`  ✓ ${l}`); }

async function main() {
  const root = mkdtempSync(join(tmpdir(), "pf-manual-"));
  mkdirSync(join(root, "state"), { recursive: true });
  mkdirSync(join(root, "manual", "inbox"), { recursive: true });
  writeFileSync(join(root, "manual", "urls.txt"), "# my sources\nhttps://example.test/report\n");
  writeFileSync(join(root, "manual", "inbox", "notes.txt"), "Internal analysis — ransomware up 40% in healthcare; recommend MFA everywhere immediately.");

  const manualFetch = async () => ({ text: "External report: zero-trust adoption accelerating across enterprises.", title: "Zero-trust report", publishedAt: null });
  const noRss = async () => [];

  // Run 1 — only manual inputs.
  const r1 = await runPipeline({ ingest: noRss, distiller: stubDistiller, manualFetch, nowISO: "2026-06-09T06:00:00Z", rootDir: root, sources: [] });
  check("run1: both manual inputs digested (snapshot = 2)", r1.snapshotSize === 2);
  check("run1: 0 legal rejects (manual exempt from allowlist, still checked)", r1.legalRejected === 0);

  const store = JSON.parse(readFileSync(join(root, "state", "store.json"), "utf8")) as FeedEntry[];
  check("manual items are foundational (persistent)", store.length === 2 && store.every((e) => e.tier === "foundational"));
  check("manual items carry a per-item manual subjectKey", store.every((e) => e.subjectKey?.startsWith("manual-")));
  check("digested, NOT verbatim (raw file text not stored)", !store.some((e) => e.summary.includes("recommend MFA everywhere immediately")));
  check("processed file moved inbox → processed", !existsSync(join(root, "manual", "inbox", "notes.txt")) && existsSync(join(root, "manual", "processed", "notes.txt")));

  // Run 2 (next day) — url already seen, file already moved → nothing new, no dupes.
  const r2 = await runPipeline({ ingest: noRss, distiller: stubDistiller, manualFetch, nowISO: "2026-06-10T06:00:00Z", rootDir: root, sources: [] });
  check("run2: no duplicates — snapshot still 2 (foundational persists, url deduped)", r2.snapshotSize === 2);

  console.log(`\n✅ ALL ${passed} CHECKS PASSED\n`);
}
main().catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}\n`); process.exitCode = 1; });
