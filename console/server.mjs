// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Príncipe Feed Console — a local, single-user admin for the feed's manual
// inputs. Zero dependencies (node:http), binds to 127.0.0.1 only (no
// exposure, no auth needed), talks to GitHub with a token from your env.
//
//   FEED_GITHUB_TOKEN=github_pat_... pnpm console
//   → http://localhost:4747
//
// FEED_GITHUB_TOKEN (PAT, Contents:write on the feed repo) + optional
// FEED_REPO (default omergrossman/principe-feed) come from the environment
// or a gitignored .env at the repo root.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (repo root), so the token can live in a gitignored file.
for (const envPath of [join(here, "..", ".env"), join(here, ".env")]) {
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const REPO = process.env.FEED_REPO || "omergrossman/principe-feed";
const TOKEN = process.env.FEED_GITHUB_TOKEN;
const PORT = Number(process.env.CONSOLE_PORT || 4747);
if (!TOKEN) {
  console.error("\n  Set FEED_GITHUB_TOKEN (env var, or a .env at the repo root).\n");
  process.exit(1);
}

const GH = "https://api.github.com";
const URLS_PATH = "manual/urls.txt";
const INBOX = "manual/inbox";
const STORE = "state/store.json";

function gh(path, init) {
  return fetch(`${GH}/repos/${REPO}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "principe-feed-console",
      "x-github-api-version": "2022-11-28",
      ...(init?.headers || {}),
    },
  });
}

async function readFile(path) {
  const r = await gh(`contents/${path}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`read ${path}: ${r.status}`);
  const j = await r.json();
  return { content: j.content ? Buffer.from(j.content, "base64").toString("utf8") : "", sha: j.sha };
}
async function putFile(path, b64, message, sha) {
  const r = await gh(`contents/${path}`, { method: "PUT", body: JSON.stringify({ message, content: b64, ...(sha ? { sha } : {}) }) });
  if (!r.ok) throw new Error(`write ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}
async function delFile(path, sha, message) {
  const r = await gh(`contents/${path}`, { method: "DELETE", body: JSON.stringify({ message, sha }) });
  if (!r.ok) throw new Error(`delete ${path}: ${r.status}`);
}

async function getState() {
  const [urlsF, inboxR, storeF, commitsR] = await Promise.all([
    readFile(URLS_PATH),
    gh(`contents/${INBOX}`),
    readFile(STORE),
    gh(`commits?path=${STORE}&per_page=6`),
  ]);
  const urls = (urlsF?.content || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  let files = [];
  if (inboxR.ok) {
    const a = await inboxR.json();
    files = a.filter((f) => f.type === "file" && !f.name.startsWith(".")).map((f) => ({ name: f.name, sha: f.sha }));
  }
  let liveCount = 0;
  try { liveCount = storeF ? JSON.parse(storeF.content).length : 0; } catch { /* ignore */ }
  let recentBuilds = [];
  if (commitsR.ok) {
    const c = await commitsR.json();
    recentBuilds = c.map((x) => ({ date: x.commit.author.date, message: x.commit.message.split("\n")[0], sha: x.sha.slice(0, 7) }));
  }
  return { repo: REPO, urls, files, liveCount, recentBuilds, anthropic: anthropicStatus() };
}

async function addUrl(url) {
  const e = await readFile(URLS_PATH);
  const body = e?.content ?? "# Manual URLs for the daily feed (one per line).\n";
  if (body.split("\n").some((l) => l.trim() === url)) return;
  const next = body.endsWith("\n") ? body + url + "\n" : body + "\n" + url + "\n";
  await putFile(URLS_PATH, Buffer.from(next).toString("base64"), "feed: add manual url via console", e?.sha);
}
async function removeUrl(url) {
  const e = await readFile(URLS_PATH);
  if (!e) return;
  const next = e.content.split("\n").filter((l) => l.trim() !== url).join("\n");
  await putFile(URLS_PATH, Buffer.from(next).toString("base64"), "feed: remove manual url via console", e.sha);
}
async function addFile(name, b64) {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_");
  const e = await readFile(`${INBOX}/${safe}`);
  await putFile(`${INBOX}/${safe}`, b64, `feed: add manual file ${safe} via console`, e?.sha);
}
async function removeFile(name, sha) {
  await delFile(`${INBOX}/${name}`, sha, `feed: remove manual file ${name} via console`);
}

// --- The feed's OWN Anthropic key (separate from Príncipe's). Stored as the
//     repo's ANTHROPIC_API_KEY Actions secret, set via the local gh CLI so
//     it never passes through here as plaintext-in-URL or needs extra token
//     scopes. The daily workflow's distill step uses it. ---
function ghCli(args, input) {
  return execFileSync("gh", args, { input, encoding: "utf8" });
}
function anthropicStatus() {
  try {
    const list = JSON.parse(ghCli(["secret", "list", "--repo", REPO, "--json", "name,updatedAt"]));
    const s = list.find((x) => x.name === "ANTHROPIC_API_KEY");
    return s ? { set: true, updatedAt: s.updatedAt } : { set: false };
  } catch (e) {
    return { set: false, error: "gh CLI not available/authed — " + String(e.message || "").split("\n")[0] };
  }
}
function setAnthropic(value) {
  ghCli(["secret", "set", "ANTHROPIC_API_KEY", "--repo", REPO], value);
}

// Entries published in a past build — store.json at that commit, rendered
// like the approval email.
async function getBuildEntries(sha) {
  const r = await gh(`contents/${STORE}?ref=${encodeURIComponent(sha)}`);
  if (!r.ok) throw new Error(`build ${sha}: ${r.status}`);
  const j = await r.json();
  const store = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
  return store.map((e) => ({ tier: e.tier, category: e.category, region: e.region, industries: e.industries || [], title: e.title, summary: e.summary, sourceUrl: e.sourceUrl }));
}

function json(res, code, obj) { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
}

const HTML = readFileSync(join(here, "index.html"), "utf8");
const ICON = readFileSync(join(here, "icon.svg"), "utf8");

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(HTML); return; }
    if (req.method === "GET" && req.url === "/icon.svg") { res.writeHead(200, { "content-type": "image/svg+xml" }); res.end(ICON); return; }
    if (req.method === "GET" && req.url === "/api/state") return json(res, 200, { ok: true, ...(await getState()) });
    if (req.method === "GET" && req.url.startsWith("/api/build")) {
      const sha = new URL(req.url, "http://x").searchParams.get("sha");
      if (!sha) return json(res, 400, { ok: false, error: "sha required" });
      return json(res, 200, { ok: true, entries: await getBuildEntries(sha) });
    }
    if (req.method === "POST" && req.url === "/api/action") {
      const b = await readBody(req);
      switch (b.action) {
        case "add-url":
          if (!/^https?:\/\/.+/.test((b.url || "").trim())) return json(res, 400, { ok: false, error: "Enter a valid http(s) URL." });
          await addUrl(b.url.trim());
          break;
        case "remove-url": await removeUrl((b.url || "").trim()); break;
        case "add-file":
          if (!b.name || !b.contentBase64) return json(res, 400, { ok: false, error: "name + contentBase64 required" });
          await addFile(b.name, b.contentBase64);
          break;
        case "remove-file": await removeFile((b.name || "").trim(), (b.sha || "").trim()); break;
        case "set-anthropic": {
          const key = (b.value || "").trim();
          if (!key.startsWith("sk-ant-")) return json(res, 400, { ok: false, error: "Enter a valid Anthropic key (sk-ant-…)." });
          setAnthropic(key);
          break;
        }
        case "run-build":
          // Trigger the daily feed workflow now (digests pending manual
          // inputs + scrapes). Uses local gh auth (Actions: write).
          ghCli(["workflow", "run", "daily.yml", "--repo", REPO]);
          break;
        default: return json(res, 400, { ok: false, error: "unknown action" });
      }
      return json(res, 200, { ok: true, ...(await getState()) });
    }
    res.writeHead(404); res.end("not found");
  } catch (e) {
    json(res, 502, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  ▲ Príncipe Feed Console\n  → http://localhost:${PORT}\n  repo: ${REPO}\n`);
});
