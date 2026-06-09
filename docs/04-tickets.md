# Ticket Architecture — Príncipe Knowledge Feed

**Date:** 2026-06-09
**Phase:** 3 — Ticket Architecture (System Analyst + QA + Security Engineer)
**Grooming policy:** Sprint 1 groomed in full; later epics stubbed at epic-level until grooming kicks off before their sprint.
**Prototype reference:** code + the 17 FRs in `docs/01-specification.md` (DP-customer pattern — no Figma).
**Build order (locked, ADR):** `principe-oss` consumer side → `principe-feed` producer side.

---

## Epic Map (from MoSCoW Must Have)

| Epic | Title | Repo | FRs | Sprint |
|------|-------|------|-----|--------|
| **EP-01** | Consumer-side targeting + snapshot apply | `principe-oss` | 14, 15, 16, 17 | **Sprint 1 (groomed)** |
| **EP-02** | Publisher pipeline core | `principe-feed` | 1, 2, 3, 6, 7, 8 | stub |
| **EP-03** | Two-tier lifecycle + legal safeguards | `principe-feed` | 4, 5, 9 | stub |
| **EP-04** | Publish + B→A mode flag | `principe-feed` | 10, 11, 12, 13 | stub |
| **EP-05** | End-to-end verification + targeting guardrails | both | 16, 17 | folded into Sprint 1 + final sprint |

---

## Sprint 1 — EP-01 (consumer side, `principe-oss`) — ✅ DELIVERED 2026-06-09 (PR #26)

> **Reshaped by grounding before build.** Reading the schema first showed `applicableIndustries` + region/industry weighting in `scoreSource` **already shipped in Sprint 4** → **01.1 + 01.2 struck, no migration.** The real gap was the bundle apply path dropping targeting metadata. Net delivered:
> - **manifest** carries optional signature-protected metadata (region/industries/category/publishedAt).
> - **apply** writes it onto the row (fixed a latent Sprint-9 bug: NULL-category bundle rows were silently excluded from briefings) + snapshot prune (`kind=BUNDLE` absent → removed) giving expiry + supersession from one mechanism, baseline structurally safe.
> - **verify-feed-apply.ts**: 25/25 checks green vs live DB in an isolated throwaway firm. `tsc` clean.

### (original grooming below — 01.1/01.2 struck, 01.3/01.4 delivered)

## Sprint 1 — EP-01 (consumer side, `principe-oss`)

> **Sprint 1 outcome (the one sentence that matters):**
> A hand-authored feed bundle installs on a real instance; industry- and region-matched entries rank up in matching personas' briefings (question-gated, demote-don't-drop), a superseding foundational entry replaces its predecessor, and an expired event drops — all via the snapshot apply — with **zero change to the `calibration/` baseline.**

**Epic Definition of Done:** the consumer contract is proven end-to-end against a fixture bundle, so the producer (EP-02+) can be built against a known-good target.

### Story 01.1 — Add nullable `KnowledgeSource.industry` — **S**
- **As** the briefing builder, **I want** an `industry` field on knowledge entries **so that** sector-specific items can be matched to same-industry personas.
- **AC** — Given the migration is applied, when I inspect `KnowledgeSource`, then `industry` exists, is nullable, and existing rows are unaffected (null).
- **AC** — Given a fresh entry, when `industry` is null, then behaviour is identical to today (general entry).
- Tasks: (a) add nullable column + migration; (b) `prisma generate`; (c) **restart Next.js dev server** ← the step that keeps getting skipped (Príncipe standing decision, hit twice); (d) smoke-read one entry with the new field before declaring done.
- Dependencies: none. **First task of the sprint.**

### Story 01.2 — Industry weighting in `briefing.ts` (mirror region) — **M**
- **As** a synthetic CISO panelist, **I want** entries matching my industry ranked higher **so that** my reasoning reflects sector-relevant reality — balanced, not alarmist.
- **AC** — Given an entry tagged `industry: healthcare`, when a healthcare persona's briefing is built, then it ranks above an equivalent untagged entry.
- **AC** — Given the same entry, when a non-healthcare persona's briefing is built, then it is demoted **but not dropped** (kept if budget allows) — mirrors the region path exactly.
- **AC (question-gated)** — Given an industry-matched entry irrelevant to the asked question, then it stays low-ranked and does not materially change that persona's verdict.
- **AC (guardrail)** — The entry appears as ranked reference material; no "urgent/breaking" flag is injected into the prompt.
- Tasks: extend the existing region-weighting branch with an industry-match branch (same demote-don't-drop + question-relevance gate); unit-test ranking with mixed tagged/untagged fixtures.
- Dependencies: 01.1.

### Story 01.3 — Snapshot-replace `apply.ts` for feed-origin rows — **M**
- **As** an opt-in instance, **I want** installing a feed bundle to reflect the current feed set **so that** expired events drop and superseded reports replace their predecessor — with no per-row TTL logic on my instance.
- **AC** — Given a bundle, when applied, then feed-origin `KnowledgeSource` rows absent from the bundle are removed and present ones upserted.
- **AC (supersession)** — Given a foundational entry sharing a stable id with a stored one, when applied, then it replaces in place (no duplicate).
- **AC (expiry)** — Given an event that has dropped out of the bundle, when applied, then it no longer surfaces in briefings.
- **🔒 Security AC (Security Engineer)** — Given ANY bundle (including an empty or malformed-but-signed one), when applied, then **no `calibration/` baseline row is ever removed or modified** — snapshot scope is restricted to feed-origin rows by construction (test with an empty bundle: baseline survives intact).
- **🔒 Security AC** — Apply runs only after the existing ed25519 signature verification passes (Sprint-9 posture unchanged).
- Tasks: add a feed-origin marker/scope to the apply query; implement snapshot diff (remove-absent + upsert-present) bounded to that scope; baseline-survival test with an empty bundle.
- Dependencies: 01.1.

### Story 01.4 — Hand-authored fixture bundle + end-to-end verification — **M**
- **As** the team, **I want** a known-good fixture bundle **so that** EP-02+ has a concrete target and the consumer contract is proven before the producer exists.
- Fixture contains: a `healthcare` event, an `anz` regulation event, a foundational analyst entry (with `subjectKey`+`reportDate`), an untagged general entry, plus a v2 of the fixture where the foundational entry is superseded and one event has dropped.
- **AC** — The fixture installs via the existing `/api/updates/install` and entries appear in a panel briefing.
- **AC** — Healthcare persona ranks the healthcare entry up; ANZ persona ranks the ANZ regulation up; an unrelated persona sees both demoted; the untagged entry reaches all equally.
- **AC** — Installing fixture-v2 replaces the superseded foundational entry and drops the removed event; baseline untouched.
- Tasks: author fixture-v1 + fixture-v2; run install + briefing inspection; record results in the Sprint 1 retro.
- Dependencies: 01.2, 01.3.

**Sprint 1 sizing:** S + M + M + M ≈ one focused build slice. No producer infra in Sprint 1 — that's the point: prove the contract cheaply.

---

## Later epics — ✅ DELIVERED 2026-06-09 (principe-feed repo, initial commit)

> Built directly (not stubbed). EP-02 pipeline (fetch/distill/dedup/cap/quality), EP-03 two-tier lifecycle + FR-9 legal safeguards, EP-04 publish + B→A mode flag + kill-switch + GitHub Releases, EP-05 end-to-end verification (`scripts/verify-roundtrip.ts`, 20 checks: real signing → real consumer verify, lifecycle, legal). principe-oss pinned as the `vendor/principe-oss` submodule. **Remaining = operational secrets only** (generate signing keypair → repo secret + consumer public key; ANTHROPIC_API_KEY; set PUBLISH_MODE=review; point an instance's PRINCIPE_UPDATES_URL at the release).

### (original epic stubs below — all delivered)

### EP-02 — Publisher pipeline core (`principe-feed`)
**DoD:** a daily Action fetches the source list, distills each item, dedups against the committed index, quality-filters, caps, and writes entries in bundle layout — output verified against the Sprint-1 fixture shape.
Seeds: repo scaffold + `principe-oss` submodule pin; source config file; reuse `fetch.ts`/`distill.ts`; committed JSON dedup index; cap + quality guard. (FR 1,2,3,6,7,8)

### EP-03 — Two-tier lifecycle + legal safeguards (`principe-feed`)
**DoD:** event TTL/expiry + foundational supersession produced correctly; **public-source allowlist + factual-summary distill + programmatic length/verbatim reject all enforced (FR-9 — PC sign-off condition).**
Seeds: tier assignment; `subjectKey`/`reportDate` supersession; allowlist gate; verbatim/length reject with a rejection fixture. (FR 4,5,9)

### EP-04 — Publish + B→A mode flag (`principe-feed`)
**DoD:** `review` mode opens a PR and merge triggers build→sign→upload to GitHub Releases + `latest.json`; `auto` mode commits direct; switch is one config change; kill-switch pauses publishing; signing key isolated.
Seeds: `build-bundle.ts` wire-up; ed25519 sign; Release upload; PR-as-gate; `PUBLISH_MODE` branch; kill-switch secret; secret-scan that key is absent from `principe-oss`. (FR 10,11,12,13)
**🔒 Security Engineer Phase-4 gate:** threat-model (a) distiller ingesting untrusted web content (prompt-injection) and (b) the auto-mode commit path, before auto is ever enabled.

### EP-05 — End-to-end verification + guardrails (both repos)
**DoD:** a real pipeline-produced bundle installs on a live instance and behaves per all FR-17 guardrails; freshness North Star measured. (Partly pre-proven by Story 01.4's fixture.)

---

## Phase 3 review sign-offs
- QA (testability of ACs): [x] — all Sprint-1 ACs are Given/When/Then and fixture-verifiable.
- Security Engineer (security ACs written, shift-left): [x] — snapshot-scope baseline-survival AC (01.3) + signature-gate AC + EP-04 Phase-4 gate flagged.
- CTO (feasibility): [x] — Sprint 1 is contract-first against existing primitives.
