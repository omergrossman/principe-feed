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
import { writeFileSync, readFileSync, rmSync, mkdirSync, cpSync, copyFileSync, existsSync } from "node:fs";
import { createPrivateKey, sign as edSign } from "node:crypto";
import { join } from "node:path";
import { signBundle } from "../src/pipeline/sign.js";

interface RawNewsItem {
  id: string;
  date: string;
  tag: string;
  channel?: string;
  title: string;
  summary?: string;
  body: string;
  link?: string;
  kind?: string;
  expires?: string;
}

// Same launch-kind inference as the web builder (scripts/build-news.mjs):
// video file → in-app player · absolute http(s) → external tab · else blog.
function inferKind(link: string): "video" | "external" | "blog" {
  if (/\.(mp4|webm|mov)(\?|#|$)/i.test(link)) return "video";
  if (/^https?:\/\//i.test(link)) return "external";
  return "blog";
}

/**
 * Build + sign the app-channel news artifact (news.json + news.json.sig)
 * from the authored master (news/items.json). The in-app "What's New"
 * center fetches these from the release and verifies the detached ed25519
 * signature against the SAME publisher key as the knowledge bundle — one
 * trust anchor for both. App channel = items routed to app|both, not past
 * expiry, newest first. Writes into `dist/` next to the bundle assets.
 */
function buildSignedNews(version: string, keyPem: string): string[] {
  const today = new Date().toISOString().slice(0, 10);
  let items: unknown[] = [];
  if (existsSync("news/items.json")) {
    const raw = JSON.parse(readFileSync("news/items.json", "utf8")) as RawNewsItem[];
    items = raw
      .filter((it) => (it.channel || "both") !== "web")
      .filter((it) => !it.expires || it.expires >= today)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .map((it) => ({
        id: it.id,
        date: it.date,
        tag: it.tag,
        channel: it.channel || "both",
        title: it.title.trim(),
        summary: (it.summary || it.body).trim().split("\n")[0].slice(0, 220),
        body: it.body.trim(),
        ...(it.link ? { link: it.link, kind: it.kind || inferKind(it.link) } : {}),
        ...(it.expires ? { expires: it.expires } : {}),
      }));
  }
  const doc =
    JSON.stringify(
      { newsVersion: 1, version, generatedAt: new Date().toISOString(), items },
      null,
      2,
    ) + "\n";
  writeFileSync("dist/news.json", doc);
  // Detached ed25519 over the EXACT bytes the consumer will fetch.
  const sig = edSign(null, Buffer.from(doc), createPrivateKey(keyPem));
  writeFileSync("dist/news.json.sig", sig);
  console.log(`[publish] signed news.json — ${items.length} app item(s)`);
  return ["dist/news.json", "dist/news.json.sig"];
}

function gh(args: string[], allowFail = false): void {
  try {
    execFileSync("gh", args, { stdio: "inherit" });
  } catch (e) {
    if (!allowFail) throw e;
  }
}

async function main() {
  // Version includes UTC time (YYYY-MM-DD-HHMM) so two builds on the same
  // day are distinct — the consumer keys "update available" on the version.
  const version = process.argv[2] ?? new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
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

    // Sign the in-app news feed alongside the knowledge bundle.
    const newsAssets = buildSignedNews(version, keyPem);

    const assets = ["dist/latest.json", "dist/latest.json.sig", `dist/${version}.tar.gz`, ...newsAssets];
    // Recreate the rolling "latest" release so the asset URLs stay stable.
    gh(["release", "delete", "latest", "--yes", "--cleanup-tag"], true);
    gh(["release", "create", "latest", "--title", `Príncipe feed ${version}`, "--notes", `Daily knowledge feed — ${version}`, ...assets]);
    console.log(`[publish] released ${version} → tag "latest"`);
  } finally {
    rmSync(keyPath, { force: true });
  }
}

main().catch((e) => { console.error("[publish] FAILED", e); process.exit(1); });
