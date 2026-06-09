// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sends the daily brief email with tap-to-approve magic links. Runs in the
// daily Action after the review PR is opened. Links are HMAC-signed and
// point at the Cloudflare Worker (approver/), which confirms then merges
// (approve) or closes (skip) the PR — no GitHub login needed.
//
// Gracefully no-ops (exit 0) if email isn't configured yet, so the daily
// pipeline keeps working before the Worker/secrets are set up.

import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import nodemailer from "nodemailer";
import type { FeedEntry } from "../src/types.js";

const { PR_NUMBER, APPROVER_URL, APPROVE_HMAC_SECRET, GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
const EMAIL_TO = process.env.EMAIL_TO ?? GMAIL_USER;

function required(): boolean {
  const miss = ["PR_NUMBER", "APPROVER_URL", "APPROVE_HMAC_SECRET", "GMAIL_USER", "GMAIL_APP_PASSWORD"]
    .filter((k) => !process.env[k]);
  if (miss.length) {
    console.log(`[send-brief] email not configured (missing ${miss.join(", ")}) — skipping.`);
    return false;
  }
  return true;
}

const EXP_MS = 7 * 86_400_000; // links valid 7 days

function link(action: "approve" | "skip", exp: number): string {
  const sig = crypto.createHmac("sha256", APPROVE_HMAC_SECRET!).update(`${action}:${PR_NUMBER}:${exp}`).digest("hex");
  return `${APPROVER_URL!.replace(/\/$/, "")}/${action}?pr=${PR_NUMBER}&exp=${exp}&sig=${sig}`;
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

function entryHtml(e: FeedEntry): string {
  const tags = [e.category, e.region, ...(e.industries ?? [])].filter(Boolean).join(" · ");
  const badge = e.tier === "foundational" ? "🏛️ foundational" : "📰 event";
  return (
    `<div style="border:1px solid #e5e7eb;border-radius:.6rem;padding:1rem;margin:.75rem 0">` +
    `<div style="font-size:.75rem;color:#6b7280;margin-bottom:.25rem">${badge} &nbsp;·&nbsp; ${esc(tags)}</div>` +
    `<div style="font-weight:600;margin-bottom:.4rem">${esc(e.title)}</div>` +
    `<div style="color:#374151;font-size:.9rem;line-height:1.45">${esc(e.summary)}</div></div>`
  );
}

async function main() {
  if (!required()) return;
  if (!existsSync("state/store.json")) { console.log("[send-brief] no store.json — skipping."); return; }

  const store = JSON.parse(readFileSync("state/store.json", "utf8")) as FeedEntry[];
  // "New today" = ingested within the last 6h (this run's additions).
  const cutoff = Date.now() - 6 * 3_600_000;
  const fresh = store.filter((e) => new Date(e.ingestedAt).getTime() >= cutoff);
  const exp = Date.now() + EXP_MS;

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const subject = `Príncipe daily brief — ${stamp}${fresh.length ? ` (${fresh.length} new)` : ""}`;
  const btn = (href: string, color: string, label: string) =>
    `<a href="${href}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;border-radius:.6rem;padding:.8rem 1.6rem;font-weight:600;margin:.3rem">${label}</a>`;

  const html =
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:34rem;margin:0 auto;color:#111">` +
    `<h2 style="font-size:1.15rem">Príncipe daily brief — ${stamp}</h2>` +
    `<p style="color:#555;font-size:.9rem">${fresh.length} new entr${fresh.length === 1 ? "y" : "ies"} · ${store.length} live in the panel. Review and approve below — the diff IS the digest.</p>` +
    (fresh.length ? fresh.map(entryHtml).join("") : `<p style="color:#6b7280">No new entries today — nothing to publish.</p>`) +
    `<div style="text-align:center;margin:1.5rem 0">${btn(link("approve", exp), "#16a34a", "✅ Approve & Publish")}${btn(link("skip", exp), "#6b7280", "✕ Skip today")}</div>` +
    `<p style="color:#9ca3af;font-size:.75rem;text-align:center">Brief #${PR_NUMBER} · links valid 7 days · you'll confirm once more before it publishes.</p></div>`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  await transporter.sendMail({ from: `Príncipe Feed <${GMAIL_USER}>`, to: EMAIL_TO, subject, html });
  console.log(`[send-brief] sent "${subject}" to ${EMAIL_TO} (${fresh.length} new, ${store.length} live)`);
}

main().catch((e) => { console.error("[send-brief] FAILED", e); process.exit(1); });
