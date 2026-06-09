// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manual ingestion — URLs + files the operator adds by hand, to be DIGESTED
// (key points only, never verbatim) into the daily package. Repo-folder
// based, no portal:
//   - add lines to  manual/urls.txt
//   - drop files in  manual/inbox/   (.pdf .txt .md .html)
// commit, and the next daily build picks them up. Processed files are moved
// to manual/processed/ and URLs are remembered, so each is ingested once.

import { readFileSync, readdirSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import type { RawItem } from "../types.js";

export const URLS_FILE = "manual/urls.txt";
export const INBOX_DIR = "manual/inbox";
export const PROCESSED_DIR = "manual/processed";

const TEXT_EXT = new Set([".txt", ".md", ".markdown"]);
const HTML_EXT = new Set([".html", ".htm"]);

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

async function pdfToText(buf: Buffer): Promise<string> {
  // Import the lib entry directly to avoid pdf-parse's debug self-test.
  // @ts-expect-error — no types for the lib subpath; shape asserted below.
  const pdf = (await import("pdf-parse/lib/pdf-parse.js")).default as (b: Buffer, o?: { max?: number }) => Promise<{ text: string }>;
  // Cap pages — an eBook can be hundreds of pages; the first ~25 carry the
  // key points and the distiller only reads the first few thousand chars
  // anyway. Time-box it so a problematic PDF can never hang the build.
  const parsed = await Promise.race([
    pdf(buf, { max: 25 }),
    new Promise<{ text: string }>((_, reject) => setTimeout(() => reject(new Error("PDF parse timed out (45s)")), 45_000)),
  ]);
  return parsed.text;
}

async function extractText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return pdfToText(readFileSync(path));
  const raw = readFileSync(path, "utf8");
  if (HTML_EXT.has(ext)) return stripHtml(raw);
  if (TEXT_EXT.has(ext)) return raw;
  return raw; // best-effort for anything else textual
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|#|$)/i.test(url);
}

/** Fetch a PDF URL's bytes + extract its text (the HTML fetcher garbles a
 *  binary PDF). Manual URLs are operator-added, so a direct fetch is fine. */
async function extractPdfFromUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; Principe-FeedBot/1.0)" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return pdfToText(Buffer.from(await res.arrayBuffer()));
}

function titleFromUrl(url: string): string {
  try {
    const n = new URL(url).pathname.split("/").pop() || "document";
    return n.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 80) || "document";
  } catch {
    return "document";
  }
}

export type ManualUrlFetch = (url: string) => Promise<{ text: string; title: string | null; publishedAt: Date | null }>;

export interface ManualLoad {
  items: RawItem[];
  processedFiles: string[]; // inbox filenames to archive after a successful build
  failures: { key: string; reason: string }[];
}

/**
 * Read manual URLs (skipping ones already seen) + inbox files into RawItems.
 * `isSeen` lets us avoid re-fetching a URL that was already digested.
 */
export async function loadManualItems(
  rootDir: string,
  fetchUrl: ManualUrlFetch,
  isSeen: (key: string) => boolean,
): Promise<ManualLoad> {
  const items: RawItem[] = [];
  const processedFiles: string[] = [];
  const failures: { key: string; reason: string }[] = [];

  const urlsPath = join(rootDir, URLS_FILE);
  if (existsSync(urlsPath)) {
    const urls = readFileSync(urlsPath, "utf8")
      .split("\n").map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    for (const url of urls) {
      if (isSeen(url)) continue; // already digested in a prior build
      try {
        if (isPdfUrl(url)) {
          const text = (await extractPdfFromUrl(url)).trim();
          if (text) items.push({ sourceKey: "manual", url, title: titleFromUrl(url), rawText: text, publishedAt: null });
          else failures.push({ key: `manual:${url}`, reason: "no text from PDF" });
        } else {
          const f = await fetchUrl(url);
          if (f.text?.trim()) {
            items.push({ sourceKey: "manual", url, title: f.title ?? url, rawText: f.text, publishedAt: f.publishedAt ? f.publishedAt.toISOString() : null });
          } else {
            failures.push({ key: `manual:${url}`, reason: "empty fetch" });
          }
        }
      } catch (e) {
        failures.push({ key: `manual:${url}`, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  const inboxPath = join(rootDir, INBOX_DIR);
  if (existsSync(inboxPath)) {
    for (const name of readdirSync(inboxPath)) {
      if (name.startsWith(".")) continue;
      try {
        const text = (await extractText(join(inboxPath, name))).trim();
        if (text) {
          items.push({ sourceKey: "manual", url: `manual:file:${name}`, title: basename(name, extname(name)), rawText: text, publishedAt: null });
          processedFiles.push(name);
        } else {
          failures.push({ key: `manual:${name}`, reason: "no text extracted" });
        }
      } catch (e) {
        failures.push({ key: `manual:${name}`, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return { items, processedFiles, failures };
}

/** Move ingested inbox files to manual/processed/ so they're not re-read. */
export function archiveProcessed(rootDir: string, names: string[]): void {
  if (names.length === 0) return;
  const proc = join(rootDir, PROCESSED_DIR);
  mkdirSync(proc, { recursive: true });
  for (const n of names) {
    try {
      renameSync(join(rootDir, INBOX_DIR, n), join(proc, n));
    } catch {
      /* best-effort */
    }
  }
}
