# Product Council Review — Príncipe Knowledge Feed

**Date:** 2026-06-09
**Status:** Sign-off with conditions

---

## Data collection necessity
- The feed collects **public** cyber-news and analyst-summary content only. No user/personal data. No PII. ✅

## Third-party data risk (the material concern)
- Analyst reports (Gartner MQ / Forrester Wave) are copyrighted and often paywalled. **Condition (binding):** foundational/analyst content is restricted to a public-source allowlist, stored as a short factual summary + attribution + link, and a programmatic check rejects over-length or near-verbatim entries (FR-9). No full-text reproduction, ever.
- Ingested web content flows into an LLM distiller → treat fetched page content as untrusted (prompt-injection surface). Flagged to Security Engineer for the Phase 4 gate.

## Compliance flags
- No app-store / financial-regulation surface. AGPL-3.0 distribution unchanged. ✅
- Existing panel disclaimer ("synthetic panel, decide for yourself") already covers downstream use of fed content. ✅

## Privacy by default
- Opt-in pull posture is preserved (instances only fetch if `PRINCIPE_UPDATES_URL` is set). No new telemetry in v1; adoption metrics are an opt-in Should-Have. ✅

## Verdict
**Sign-off granted, conditional on FR-9 (legal safeguards) shipping as Must-Have in v1** — not deferred. The copyright posture is the one place this feature carries real risk; it must be built, not promised.
