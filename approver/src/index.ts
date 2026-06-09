// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Email approval endpoint for the Príncipe daily brief.
//
// The daily email contains HMAC-signed magic links to /approve and /skip.
// To defeat email link-prefetchers (Gmail/Outlook scanners would otherwise
// auto-trigger a GET), a GET only renders a CONFIRMATION page; the actual
// merge/close happens on the POST from that page's button.
//
// Secrets (wrangler secret put …):
//   GH_TOKEN              fine-grained PAT, Pull requests: write on the repo
//   APPROVE_HMAC_SECRET   shared with the publisher Action (signs the links)
// Var (wrangler.toml):
//   GH_REPO               "owner/repo"

export interface Env {
  GH_TOKEN: string;
  APPROVE_HMAC_SECRET: string;
  GH_REPO: string;
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function page(emoji: string, title: string, msg: string, status = 200, extra = ""): Response {
  return new Response(
    `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">` +
    `<body style="font-family:system-ui,-apple-system,sans-serif;max-width:30rem;margin:4rem auto;padding:0 1.5rem;text-align:center;color:#1a1a1a">` +
    `<div style="font-size:3rem;line-height:1">${emoji}</div>` +
    `<h1 style="font-size:1.25rem;margin:.75rem 0">${title}</h1>` +
    `<p style="color:#555;line-height:1.5">${msg}</p>${extra}</body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const action = url.pathname.replace(/^\/+/, "");
    if (action !== "approve" && action !== "skip") {
      return page("🤖", "Príncipe feed approver", "Nothing to see here.", 404);
    }

    const pr = url.searchParams.get("pr") ?? "";
    const exp = url.searchParams.get("exp") ?? "";
    const sig = url.searchParams.get("sig") ?? "";
    if (!pr || !exp || !sig) return page("⚠️", "Invalid link", "Missing parameters.", 400);
    if (Date.now() > Number(exp)) return page("⏰", "Link expired", "This approval link has expired — use a newer daily brief.", 410);

    const expected = await hmacHex(env.APPROVE_HMAC_SECRET, `${action}:${pr}:${exp}`);
    if (!safeEqual(expected, sig)) return page("⛔", "Invalid link", "Signature check failed.", 403);

    // GET → confirmation page (defeats link prefetch). POST → do it.
    if (req.method !== "POST") {
      const label = action === "approve" ? "Publish brief" : "Skip today";
      const color = action === "approve" ? "#16a34a" : "#6b7280";
      const form =
        `<form method="POST" action="${url.pathname}${url.search}" style="margin-top:1.5rem">` +
        `<button style="background:${color};color:#fff;border:0;border-radius:.6rem;padding:.8rem 1.6rem;font-size:1rem;cursor:pointer">` +
        `${action === "approve" ? "✅ Confirm — publish" : "✕ Confirm — skip"}</button></form>`;
      return page(
        action === "approve" ? "📨" : "🗑️",
        `${label} #${pr}?`,
        action === "approve" ? "Confirm to sign and publish today's brief." : "Confirm to discard today's brief. Nothing publishes.",
        200, form,
      );
    }

    const api = `https://api.github.com/repos/${env.GH_REPO}/pulls/${pr}`;
    const headers = {
      authorization: `Bearer ${env.GH_TOKEN}`,
      "user-agent": "principe-feed-approver",
      accept: "application/vnd.github+json",
    };
    if (action === "approve") {
      const r = await fetch(`${api}/merge`, { method: "PUT", headers, body: JSON.stringify({ merge_method: "squash" }) });
      if (!r.ok) return page("⚠️", "Couldn't publish", `GitHub returned ${r.status}. The brief may already be merged or closed.`, 502);
      return page("✅", "Published", `Brief #${pr} approved — signing and publishing to the feed now.`);
    }
    const r = await fetch(api, { method: "PATCH", headers, body: JSON.stringify({ state: "closed" }) });
    if (!r.ok) return page("⚠️", "Couldn't skip", `GitHub returned ${r.status}.`, 502);
    return page("🗑️", "Skipped", `Brief #${pr} was skipped. Nothing published.`);
  },
};
