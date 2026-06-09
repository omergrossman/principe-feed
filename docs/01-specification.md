# Príncipe Knowledge Feed — Specification

**Date:** 2026-06-09
**Status:** Draft — sign-offs pending
**Owner:** OBT System Analyst
**Upstream source:** OPM engineering brief — `~/pm-os/outputs/obt-handoffs/principe-knowledge-feed-brief-2026-06-09.md` (treated as the Phase 1 Context Dump)
**Phase 1 decisions (Omer, 2026-06-09):** both tiers in v1 · standalone private `principe-feed` repo · GitHub Releases hosting

---

## Problem Statement

Príncipe's synthetic CISO panel reasons over a **static baseline corpus** (`calibration/`). As cyber reality moves — breaches, campaigns, regulation, vendor launches, analyst repositioning — the panel's verdicts drift from the present, eroding the "honest calibration / current reality" promise that is Príncipe's wedge. We need a **recurring daily cyber-news feed** plus a **persistent structural layer** (analyst/framework grounding), delivered through the **existing Sprint-9 signed-bundle pipeline**, that keeps every opt-in instance current with near-zero ongoing effort.

## User Personas

**Omer — Publisher / Operator**
- Goal: keep the panel current and well-grounded with < 2 min/day of effort; flip from human-review to fully automatic when trust is earned, with no code change.
- Frustration: a static corpus silently goes stale; manual curation doesn't scale daily.

**Opt-in self-host operator — runs a Príncipe instance**
- Goal: instance receives the daily feed automatically (existing pull-update), zero action.
- Frustration: none required — opt-in posture is unchanged.

**Synthetic CISO panelist — system persona**
- Goal: briefing reflects both current events and current structural reality, weighted to the persona's region/industry — balanced, never alarmist.
- Frustration: reasoning from a frozen world produces dated verdicts.

## Feature List (MoSCoW)

### Must Have (v1)
- Daily scheduled GitHub Action: fetch → distill → dedup → quality-filter → cap → write entries → publish.
- **Event tier** — ephemeral, `expiresAt = publishedAt + TTL_DAYS` (default 30), accumulate-then-expire.
- **Foundational tier** — persistent (`expiresAt = null`), version-superseding via stable `subjectKey` + `reportDate`.
- **Region targeting** — reuse existing `KnowledgeSource.region` + `briefing.ts` ranking (no app change).
- **Industry targeting** — new nullable `KnowledgeSource.industry` + `briefing.ts` weighting mirroring the region path *(change inside `principe-oss`)*.
- **B→A mode flag** — `PUBLISH_MODE = review | auto`; review = PR-as-gate, auto = commit-direct; switch is one config change.
- **Legal safeguards (automated)** — public-source allowlist for foundational/analyst content; distiller emits factual summary + attribution + link; programmatic check rejects over-length or near-verbatim entries.
- **Dedup** — committed rolling index (URL + contentHash) surviving across runs.
- **Cap** — `MAX_ITEMS_PER_DAY` (default ~20) new event entries/run; foundational uncapped.
- **Quality guard** — failed fetch/distill or sub-threshold relevance → skipped + logged, never published malformed.
- **Kill-switch** — single secret/config pauses all publishing.
- **Sign + publish** — reuse `build-bundle.ts` → ed25519-sign → upload bundle + `latest.json` to **GitHub Releases**.
- **End-to-end install** — bundle installs via existing `/api/updates/install` on a real instance; entries appear in a panel briefing.

### Should Have (fast-follow, not gating v1)
- Per-category distillation prompts tuned for tone/quality.
- Opt-in adoption telemetry (% of instances pulling each daily bundle).
- Custom `updates.principe.cloud` domain in front of the release assets.

### Won't Have (this version)
- Multiple / decentralized curated feeds (self-host DIY via custom `PRINCIPE_UPDATES_URL` already supported — out of scope).
- Replacing the `calibration/` baseline (this augments it).
- Storing or redistributing full third-party report text — ever.

## Functional Requirements (numbered, testable)

1. A daily scheduled GitHub Action fetches every source URL in a curated config (reuse `fetch.ts`, SSRF-safe), preferring RSS where available.
2. Each item is distilled (reuse `distill.ts`) into the Entry shape: `{ id, tier, category, region?, industry?, title, summary (2–3 sentences), sourceUrl, publishedAt, contentHash, expiresAt?, subjectKey?, reportDate? }`, mapped into the Sprint-9 `knowledge/` bundle layout.
3. `category ∈ { attack, threat-intel, strategy, product-release, regulation }`; `tier ∈ { event, foundational }`.
4. Event entries get `expiresAt = publishedAt + TTL_DAYS` (default 30); foundational entries get `expiresAt = null`.
5. **Supersession:** a foundational item with an existing `subjectKey` and a later `reportDate` replaces the stored entry in place (stable-id upsert); a same-or-older `reportDate` is skipped.
6. **Dedup:** an item already in the committed rolling index (keyed by URL + contentHash) is not re-added; the index persists across runs.
7. **Cap:** at most `MAX_ITEMS_PER_DAY` (default 20) new event entries per run; foundational entries are not capped.
8. **Quality guard:** an item whose fetch or distillation fails, or which scores below a relevance threshold, is skipped and logged — never published as malformed content.
9. **Legal:** foundational/analyst content is fetched ONLY from a curated public-source allowlist; the distiller emits a short factual summary + attribution + source link; a programmatic check **rejects** any entry exceeding a length cap OR overlapping source text beyond a verbatim threshold. (Fixture: an over-long / near-verbatim entry is rejected.)
10. **`review` mode:** the run opens a PR with the day's added/expired/superseded entries and does NOT push to `main`; merging the PR triggers `build-bundle.ts` → sign → upload to a GitHub Release + bump `latest.json`. Both tiers route through the PR.
11. **`auto` mode:** the same pipeline commits to `main` and publishes with no PR. Both tiers. The B→A switch is one config change — no code change.
12. **Kill-switch:** a single config/secret pauses all publishing.
13. The signing key is read only from the `principe-feed` Action secrets; it is absent from `principe-oss`.
14. *(principe-oss)* A nullable `KnowledgeSource.industry` column is added (migration); `briefing.ts` weighting bumps an entry whose `industry` matches the persona's industry, **mirroring the region path** — demote-don't-drop, question-gated.
15. *(principe-oss)* The install/apply step handles expiry + supersession (snapshot-replace for feed entries OR respect `expiresAt`); foundational replacement is a stable-id upsert. (Sprint-9 `apply.ts` currently only upserts — see ADR.)
16. A bundle produced by the pipeline installs cleanly via the existing `/api/updates/install` on a real instance, and the entries appear in a panel briefing.
17. **Targeting guardrails:** matched entries get a rank/salience bump only (never a priority override or "urgent/breaking" flag); influence is question-gated; untagged (null region AND null industry) entries reach all personas equally; summaries are factual, non-sensational.

## Non-Functional Requirements

- **Freshness (North Star):** median `publishedAt` age of the newest 5 entries < 24h.
- **Publisher effort (review mode):** < 2 min/day to approve.
- **Security:** signing key isolated to the feed repo's Action secrets; SSRF-safe fetch; opt-in pull posture unchanged; ed25519 verify on install; non-secret config in-repo.
- **Legal:** no full-text third-party report stored or redistributed; public material only; factual summaries with attribution.
- **Cost / infra:** GitHub Releases hosting — no new infrastructure, no ongoing host cost.

## Open Questions (non-gating — resolved in ADR / sprint grooming)

- [ ] Final source list + per-category distillation prompt (curation; ADR proposes a starter set).
- [ ] `apply.ts` mechanism: snapshot-replace vs `expiresAt`-respecting (ADR — FR-15).
- [ ] How `principe-feed` reuses `principe-oss`'s `fetch.ts` / `distill.ts` / `build-bundle.ts` (submodule vs vendored package — ADR).
- [ ] Custom `updates.principe.cloud` domain in front of GitHub Releases (Should-Have; v1 uses the release raw URL).

## Sign-offs

- CTO: [x] (ADR — `docs/02-adr.md`)
- Product Council: [x] conditional on FR-9 in v1 (note — `docs/03-product-council.md`)
- Omer: [x] 2026-06-09 ("agree with everything"); Design phase skipped (no new UI surface)
