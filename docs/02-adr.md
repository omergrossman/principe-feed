# ADR — Príncipe Knowledge Feed

**Date:** 2026-06-09
**Author:** OBT CTO
**Status:** Proposed (pairs with `docs/01-specification.md`)

---

## Scale Assessment

- **Publishers:** 1 (Omer's curated feed).
- **Throughput:** ~20 event entries/day + rare foundational entries; daily cadence.
- **Consumers:** N opt-in instances pulling a static signed bundle (read-only, cacheable).
- Verdict: **tiny, batch, static-output.** No server, no DB on the publisher side. A scheduled job that emits signed static files is the entire shape.

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | GitHub Actions (scheduled `cron`) + Node/TypeScript scripts | Publisher is a daily batch job; the Action is also the publish trigger (merge → build). No always-on service. |
| Language | TypeScript | Reuses `principe-oss`'s existing TS primitives (`fetch.ts`, `distill.ts`, `build-bundle.ts`). |
| Distillation | Anthropic API (`claude-haiku-4-5`, matches panel) | Same model family as the panel; cheap, fast, sufficient for summarization. |
| Dedup index | **Committed JSON** in the repo | Simple, diffable, survives runs, shows up in the review-mode PR. No external store for ~thousands of small records. |
| Bundle host | **GitHub Releases** | Signed bundle + `latest.json` as release assets. Free, no infra, fits post-Vercel. Custom domain deferred (Should-Have). |
| Signing | ed25519 (existing Sprint-9 tooling), key in `principe-feed` Action secrets | Single source of signing; key never in `principe-oss`. |
| Repo | Standalone private `principe-feed` | Isolation of publisher + key from distributed OSS code. |

## Key Architectural Decision — reusing `principe-oss` primitives

`principe-feed` needs `fetch.ts` (SSRF-safe), `distill.ts`, and `build-bundle.ts` / `generate-keypair.ts`, all of which live in `principe-oss`. The SSRF fetcher is security-sensitive — copy-drift there is a real risk.

**Decision: pin `principe-oss` as a git submodule** in `principe-feed` and import the real modules — single source of truth for the security-sensitive fetcher, no vendored copy to drift. The submodule is pinned to a known-good commit and bumped deliberately.
- *Rejected — vendoring/copying the files:* fast, but the SSRF fetcher would silently diverge from upstream fixes. Unacceptable for a security primitive.
- *Rejected — extracting a shared npm package now:* correct long-term, premature for v1. Revisit if a third consumer appears.

## Data Model

- **Publisher:** no DB. State = committed JSON (rolling dedup index + the `knowledge/` entry files that become the bundle).
- **Entry** (FR-2): `{ id, tier, category, region?, industry?, title, summary, sourceUrl, publishedAt, contentHash, expiresAt?, subjectKey?, reportDate? }`.
- **`principe-oss` change:** add nullable `KnowledgeSource.industry`. Mirror the existing `region` weighting in `briefing.ts`. (Per Príncipe standing decision: nullable, and **restart the Next.js dev server after the migration** — this trap has bitten twice.)

## Integration Points

- Anthropic API (distillation).
- Source RSS/HTML endpoints (read-only, via SSRF-safe fetch).
- GitHub Releases (publish target) + GitHub PR API (review-mode gate).
- `principe-oss` updates consumer (`/api/updates/*`) — **unchanged**, only fed.

## Security Posture

- Signing key in `principe-feed` Action secrets only (FR-13).
- SSRF-safe fetch reused, not reimplemented (submodule).
- Public-source allowlist + programmatic verbatim/length reject for foundational content (FR-9) — both a legal and an injection-surface control.
- Opt-in pull + ed25519 verify on install unchanged (Sprint-9 posture preserved).
- **Security Engineer gate (Phase 4):** the new attack surface is (a) the distiller ingesting arbitrary fetched web content and (b) the auto-mode commit path. Re-derive the threat model there, not here.

## The `apply.ts` question (FR-15)

Sprint-9's `apply.ts` upserts entries by id and never removes. Expiry + supersession need removal/replacement.

**Recommendation: treat the feed bundle as a full snapshot of the current feed-kind set.** On install, feed-kind `KnowledgeSource` rows not present in the incoming bundle are removed; present ones are upserted. This makes both **expiry** (an expired event simply isn't in tomorrow's bundle) and **foundational supersession** (the new report ships under the same stable id) fall out of one mechanism, with no per-row TTL logic on the instance. Scope the snapshot to feed-origin rows only — never touch `calibration/` baseline rows.

## Trade-offs Accepted

- **GitHub Releases over CDN/custom domain:** no branded `updates.principe.cloud` yet; raw release URL in `PRINCIPE_UPDATES_URL`. Acceptable — branding is a Should-Have, swappable later behind the same opt-in env var.
- **Committed JSON index over a DB:** not concurrent-safe, but a single daily serial job has no concurrency. Diffability in the PR is a feature.
- **Snapshot-replace apply:** slightly more destructive than append, but bounded to feed-origin rows and far simpler than per-row TTL bookkeeping on every instance.

## Shortcuts Taken (ticket immediately)

- Custom domain for the bundle host deferred → ticket as a Should-Have.
- Per-category distillation-prompt tuning starts with one shared prompt → ticket for refinement after review-mode days produce real examples.

## Cross-repo sequencing (locked)

1. **`principe-oss` first:** `industry` migration + `briefing.ts` weighting + `apply.ts` snapshot semantics — so an installed instance can match and correctly apply feed bundles.
2. **`principe-feed` second:** pipeline, mode flag, legal safeguards, publish to Releases.

Reason: a bundle is useless before the consumer can match/apply it. Build the consumer side, then the producer.
