// SPDX-License-Identifier: AGPL-3.0-or-later
//
// EP-02→05 end-to-end verification: drive the real producer pipeline with
// fixtures, sign with the REAL principe-oss build-bundle (a fresh test
// keypair), and prove the bundle is consumer-valid (signature verifies,
// manifest shape passes isBundleManifest, entries carry targeting
// metadata, tarball unpacks with matching hashes). Then prove the two-tier
// lifecycle (supersession + expiry) across two runs, and the FR-9 legal
// gate. No network, no DB, no real key.
//
//   PRINCIPE_OSS_DIR=../principe-oss pnpm verify

import crypto from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { runPipeline } from "../src/run-daily.js";
import { SOURCES, type SourceDef } from "../src/config/sources.js";
import { stubDistiller } from "../src/pipeline/distill.js";
import { checkEntry } from "../src/pipeline/legal.js";
import { signBundle } from "../src/pipeline/sign.js";
import type { FetchFn } from "../src/pipeline/fetch.js";
import type { FeedEntry, RawItem } from "../src/types.js";
import { SUMMARY_MAX_CHARS } from "../src/config/sources.js";

const ossDir = resolve(process.env.PRINCIPE_OSS_DIR ?? "../principe-oss");

let passed = 0;
function check(label: string, cond: boolean) {
  if (!cond) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

function sha256(s: string | Buffer): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

const src = (key: string): SourceDef => SOURCES.find((s) => s.key === key)!;

/** Build a fetchFn that serves canned text per source URL. */
function fixtureFetch(map: Record<string, { title: string; text: string; publishedAt: string }>): FetchFn {
  return async (url: string) => {
    const f = map[url];
    if (!f) throw new Error(`no fixture for ${url}`);
    return { text: f.text, contentHash: sha256(f.text), title: f.title, publishedAt: new Date(f.publishedAt) };
  };
}

async function main() {
  // Fresh ed25519 keypair → PEM private (for build-bundle) + hex public.
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }) as string;
  const pubHex = Buffer.from(publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("hex");
  process.env.PRINCIPE_UPDATES_PUBLIC_KEY = pubHex;

  const tmp = mkdtempSync(join(tmpdir(), "pf-"));
  const root = join(tmp, "repo"); mkdirSync(join(root, "state"), { recursive: true });
  const keyPath = join(tmp, "key.pem"); writeFileSync(keyPath, pem);
  const out = join(tmp, "out");

  const T0 = "2026-06-09T06:00:00Z";

  // ---- Run 1 ----
  console.log("\nRun 1 — fetch → distill → legal → dedup → lifecycle → emit");
  const run1Sources = [src("cisa"), src("acsc-anz"), src("gartner-newsroom"), src("bleeping")];
  const fetch1 = fixtureFetch({
    [src("cisa").url]: { title: "Ransomware disrupts hospital patient care systems", text: "A ransomware operator disrupted hospital patient health record systems across several US providers this week, affecting clinical workflows.", publishedAt: T0 },
    [src("acsc-anz").url]: { title: "ANZ tightens mandatory breach reporting windows", text: "Australian authorities shortened the mandatory data breach notification window for regulated entities operating in the region.", publishedAt: T0 },
    [src("gartner-newsroom").url]: { title: "Gartner names 2026 Leaders in endpoint protection", text: "Gartner announced the vendors recognized as Leaders in its public 2026 endpoint protection evaluation in a press release.", publishedAt: "2026-01-15T00:00:00Z" },
    [src("bleeping").url]: { title: "Infostealer malware trend continues to grow", text: "Researchers observed a continued rise in infostealer malware distributed through malicious advertising over the past quarter.", publishedAt: T0 },
  });
  const r1 = await runPipeline({ fetchFn: fetch1, distiller: stubDistiller, nowISO: T0, rootDir: root, sources: run1Sources });
  check("run1: 4 fetched", r1.fetched === 4);
  check("run1: 0 legal rejects", r1.legalRejected === 0);
  check("run1: snapshot = 4 entries", r1.snapshotSize === 4);

  const meta1 = JSON.parse(readFileSync(join(root, "feed-metadata.json"), "utf8")) as Record<string, { region?: string; industries?: string[] }>;
  const cisaMeta = Object.entries(meta1).find(([, m]) => m.region === "us")?.[1];
  check("run1: healthcare/us entry tagged region=us", cisaMeta?.region === "us");
  check("run1: healthcare entry tagged industries=[healthcare]", JSON.stringify(cisaMeta?.industries) === JSON.stringify(["healthcare"]));
  check("run1: anz entry present in metadata", Object.values(meta1).some((m) => m.region === "anz"));

  // ---- Sign with real principe-oss build-bundle ----
  console.log("Sign — real principe-oss build-bundle + ed25519");
  signBundle("v1", root, out, keyPath);
  const manifestBytes = readFileSync(join(out, "manifests", "v1.json"));
  const sig = readFileSync(join(out, "manifests", "v1.json.sig"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));

  // Consumer-side verification (imported from principe-oss).
  const verify = await import(pathToFileURL(join(ossDir, "apps/principe/src/lib/updates/verify.ts")).href);
  const manifestMod = await import(pathToFileURL(join(ossDir, "apps/principe/src/lib/updates/manifest.ts")).href);
  check("bundle: ed25519 signature verifies", verify.verifyManifestSignature(manifestBytes, sig) === true);
  check("bundle: passes isBundleManifest", manifestMod.isBundleManifest(manifest) === true);

  const cisaEntry = manifest.entries.find((e: { region?: string }) => e.region === "us");
  check("bundle: targeting metadata survived into SIGNED manifest", cisaEntry?.region === "us" && JSON.stringify(cisaEntry?.industries) === JSON.stringify(["healthcare"]));
  check("bundle: entry carries category + publishedAt", typeof cisaEntry?.category === "string" && typeof cisaEntry?.publishedAt === "string");

  // Unpack the tarball and verify each entry's content hash matches.
  const extract = join(tmp, "extract"); mkdirSync(extract);
  execFileSync("tar", ["-xzf", join(out, manifest.bundlePath), "-C", extract]);
  let hashOk = true;
  for (const e of manifest.entries) {
    const bytes = readFileSync(join(extract, e.path));
    if (sha256(bytes) !== e.sha256) hashOk = false;
  }
  check("bundle: every unpacked entry matches its manifest sha256", hashOk);
  check("bundle: tarball has 4 knowledge files", readdirSync(join(extract, "knowledge")).length === 4);

  // ---- Run 2 — supersession + expiry (31 days later) ----
  console.log("Run 2 — supersession + expiry (T0 + 31d)");
  const T1 = new Date(new Date(T0).getTime() + 31 * 86_400_000).toISOString();
  const run2Sources = [src("gartner-newsroom"), src("krebs")];
  const fetch2 = fixtureFetch({
    [src("gartner-newsroom").url]: { title: "Gartner 2026 H2 update revises endpoint Leaders", text: "Gartner published a mid-year revision to its public endpoint protection Leaders recognition, adding two vendors in a press release.", publishedAt: T1 },
    [src("krebs").url]: { title: "New supply-chain compromise hits build pipelines", text: "A newly disclosed supply-chain compromise targeted software build pipelines, injecting malicious dependencies during continuous integration.", publishedAt: T1 },
  });
  const r2 = await runPipeline({ fetchFn: fetch2, distiller: stubDistiller, nowISO: T1, rootDir: root, sources: run2Sources });
  check("run2: snapshot = 2 (foundational persists + 1 new event; 3 stale events expired)", r2.snapshotSize === 2);

  const store2 = JSON.parse(readFileSync(join(root, "state", "store.json"), "utf8")) as FeedEntry[];
  const found = store2.filter((e) => e.tier === "foundational");
  check("run2: exactly one foundational entry (superseded in place)", found.length === 1);
  check("run2: foundational content is the H2 revision", found[0].summary.includes("Gartner") && found[0].reportDate === T1);
  check("run2: expired healthcare event is gone", !store2.some((e) => e.industries?.includes("healthcare")));
  check("run2: new supply-chain event present", store2.some((e) => e.tier === "event"));

  // ---- FR-9 legal gate (unit) ----
  console.log("Legal gate (FR-9)");
  const raw: RawItem = { sourceKey: "x", url: src("krebs").url, title: "t", rawText: "the quick brown fox jumps over the lazy dog and then runs far away quickly today", publishedAt: T0 };
  const clean: FeedEntry = { id: "knowledge:x", tier: "event", category: "news", title: "t", summary: "An incident was reported and tracked for prioritisation purposes by analysts.", sourceUrl: raw.url, publishedAt: T0, contentHash: "h", ingestedAt: T0 };
  check("legal: clean factual summary passes", checkEntry(clean, raw, src("krebs")).ok === true);
  const verbatim: FeedEntry = { ...clean, summary: "the quick brown fox jumps over the lazy dog and then runs far" };
  check("legal: verbatim copy of source run is REJECTED", checkEntry(verbatim, raw, src("krebs")).ok === false);
  const tooLong: FeedEntry = { ...clean, summary: "x".repeat(SUMMARY_MAX_CHARS + 1) };
  check("legal: over-length summary is REJECTED", checkEntry(tooLong, raw, src("krebs")).ok === false);

  console.log(`\n✅ ALL ${passed} CHECKS PASSED\n`);
}

main().catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}\n`); process.exitCode = 1; });
