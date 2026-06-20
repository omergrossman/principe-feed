#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// build-news — derives the PUBLIC web view (news.json) from the authored master
// (news/items.json). The website reads news.json; the app gets news through the
// signed bundle (handled separately in the pipeline). One source, two channels.
//
//   node scripts/build-news.mjs
//
// Items are operator-authored and published VERBATIM — they do not pass through
// the LLM distiller or the legal/verbatim gate (that's for scraped third-party
// content, not our own announcements).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "news", "items.json");
const OUT = join(ROOT, "news.json");

const TAGS = new Set(["feature", "calibration", "security", "release", "research", "tip"]);
const CHANNELS = new Set(["app", "web", "both"]);
const KINDS = new Set(["blog", "external", "video"]);

// Infer how a link should launch when the author didn't say:
//   video file → lightbox · absolute http(s) → new tab · relative path → internal page
function inferKind(link) {
  if (/\.(mp4|webm|mov)(\?|#|$)/i.test(link)) return "video";
  if (/^https?:\/\//i.test(link)) return "external";
  return "blog";
}

if (!existsSync(SRC)) {
  console.error(`✖ ${SRC} not found`);
  process.exit(1);
}

let items;
try {
  items = JSON.parse(readFileSync(SRC, "utf8"));
} catch (e) {
  console.error(`✖ news/items.json is not valid JSON: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(items)) {
  console.error("✖ news/items.json must be an array of items");
  process.exit(1);
}

const errors = [];
const seen = new Set();
for (const [i, it] of items.entries()) {
  const where = it && it.id ? `item "${it.id}"` : `item #${i + 1}`;
  if (!it || typeof it !== "object") { errors.push(`${where}: not an object`); continue; }
  if (!it.id || !/^[a-z0-9-]+$/.test(it.id)) errors.push(`${where}: id must be a kebab-case slug`);
  if (seen.has(it.id)) errors.push(`${where}: duplicate id`);
  seen.add(it.id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date || "")) errors.push(`${where}: date must be YYYY-MM-DD`);
  if (!TAGS.has(it.tag)) errors.push(`${where}: tag must be one of ${[...TAGS].join(", ")}`);
  if (!CHANNELS.has(it.channel || "both")) errors.push(`${where}: channel must be app|web|both`);
  if (!it.title || !it.title.trim()) errors.push(`${where}: title required`);
  if (!it.body || !it.body.trim()) errors.push(`${where}: body required`);
  if (it.kind && !KINDS.has(it.kind)) errors.push(`${where}: kind must be blog|external|video`);
  if (it.kind && !it.link) errors.push(`${where}: kind set but no link`);
  if (it.expires && !/^\d{4}-\d{2}-\d{2}$/.test(it.expires)) errors.push(`${where}: expires must be YYYY-MM-DD`);
}
if (errors.length) {
  console.error("✖ news/items.json validation failed:\n  - " + errors.join("\n  - "));
  process.exit(1);
}

// Web view: items routed to web or both, not past their optional expiry, newest first.
const TODAY = new Date().toISOString().slice(0, 10);
const webItems = items
  .filter((it) => (it.channel || "both") !== "app")
  .filter((it) => !it.expires || it.expires >= TODAY) // optional time-bound announcements drop off
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  .map((it) => ({
    id: it.id,
    date: it.date,
    tag: it.tag,
    title: it.title.trim(),
    summary: (it.summary || it.body).trim().split("\n")[0].slice(0, 220),
    body: it.body.trim(),
    ...(it.link ? { link: it.link, kind: it.kind || inferKind(it.link) } : {}),
  }));

const out = { updated: new Date().toISOString().slice(0, 10), count: webItems.length, items: webItems };
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`✓ news.json — ${webItems.length} web item(s) from ${items.length} authored`);
