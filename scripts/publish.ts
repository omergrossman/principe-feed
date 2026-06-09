// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Publish step — runs on `main` (publish.yml) after the daily snapshot
// lands (via merged PR in review mode, or direct push in auto mode).
// Signs the committed snapshot with the real principe-oss build-bundle
// (flat layout) and uploads it to the rolling "latest" GitHub Release, so
// consumers' PRINCIPE_UPDATES_URL/latest.json stays at a stable URL.
//
//   PRINCIPE_UPDATES_URL (consumer) =
//     https://github.com/<owner>/principe-feed/releases/download/latest

import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync, cpSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { signBundle } from "../src/pipeline/sign.js";

function gh(args: string[], allowFail = false): void {
  try {
    execFileSync("gh", args, { stdio: "inherit" });
  } catch (e) {
    if (!allowFail) throw e;
  }
}

async function main() {
  const version = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const keyPem = process.env.PRINCIPE_UPDATES_PRIVATE_KEY;
  if (!keyPem) throw new Error("PRINCIPE_UPDATES_PRIVATE_KEY secret is required");

  const keyPath = "key.pem";
  writeFileSync(keyPath, keyPem, { mode: 0o600 });
  try {
    // Stage ONLY the bundle content into a clean dir — build-bundle walks
    // its input dir recursively, so feeding it the repo root would recurse
    // node_modules/vendor symlink cycles (stack overflow).
    const stage = "dist-input";
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    cpSync("knowledge", join(stage, "knowledge"), { recursive: true });
    if (existsSync("feed-metadata.json")) {
      copyFileSync("feed-metadata.json", join(stage, "feed-metadata.json"));
    }

    process.env.BUNDLE_FLAT = "1"; // flat asset layout for Release hosting
    signBundle(version, stage, "dist", keyPath);

    const assets = ["dist/latest.json", "dist/latest.json.sig", `dist/${version}.tar.gz`];
    // Recreate the rolling "latest" release so the asset URLs stay stable.
    gh(["release", "delete", "latest", "--yes", "--cleanup-tag"], true);
    gh(["release", "create", "latest", "--title", `Príncipe feed ${version}`, "--notes", `Daily knowledge feed — ${version}`, ...assets]);
    console.log(`[publish] released ${version} → tag "latest"`);
  } finally {
    rmSync(keyPath, { force: true });
  }
}

main().catch((e) => { console.error("[publish] FAILED", e); process.exit(1); });
