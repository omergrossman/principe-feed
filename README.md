# principe-feed

Daily cyber-news feed **publisher** for the [Príncipe](https://github.com/omergrossman/principe-oss) synthetic-CISO panel. Scrapes a curated set of public sources, distills each item into a short factual entry, and publishes a **signed knowledge bundle** that opt-in Príncipe instances pull automatically — keeping every panel grounded in current reality.

> Producer side only. The consumer (bundle install + briefing targeting) lives in `principe-oss`. Designed via OPM → OBT; spec/ADR/tickets in the `principe-oss` design docs.

## Pipeline (daily GitHub Action)

```
fetch (SSRF-safe, allowlisted)  →  distill (claude-haiku-4-5, factual/non-alarmist)
  →  legal gate (public-source allowlist + length cap + verbatim reject)
  →  dedup (rolling committed index)  →  cap (≤20 new events/day)
  →  lifecycle (event TTL 30d / foundational supersession)  →  snapshot
  →  emit knowledge/*.md + feed-metadata.json  →  sign + upload (GitHub Releases)
```

## Two knowledge tiers

- **event** — attacks, threat-intel, news, regulation. TTL 30d, accumulate→expire.
- **foundational** — public analyst summaries (e.g. "named a Leader"), framework updates. Persistent; a newer report supersedes the older one in place via a stable `subjectKey`.

## Region/industry targeting

Entries carry optional `region` / `industries`. The consumer's briefing scorer ranks a matched entry up for matching personas (demote-don't-drop, question-gated) — balanced, never alarmist. Untagged = general, reaches all personas equally.

## The B→A switch (one config change, no code change)

`PUBLISH_MODE` repo variable:
- **`review`** (B, default) — the daily run opens a **PR**. The diff is the digest; merge to publish, close to skip.
- **`auto`** (A) — the daily run pushes straight to `main`, which publishes.

`FEED_PAUSED=1` is the kill-switch. The signing key (`PRINCIPE_UPDATES_PRIVATE_KEY`) lives ONLY in this repo's secrets — never in `principe-oss`.

## Legal posture (FR-9)

Analyst/foundational content is fetched only from a **public-source allowlist**, summarized factually with attribution + link, and a programmatic check **rejects** any entry that's over-length or shares a verbatim run with the source. No full third-party report text is ever stored or redistributed.

## Reuse, not fork

`principe-oss` is a pinned **git submodule** at `vendor/principe-oss`. The SSRF-safe fetcher and the signed-bundle builder are imported from it — never copied — so the security-sensitive primitives stay single-sourced.

## Dev

```bash
pnpm install
PRINCIPE_OSS_DIR=../principe-oss node --import tsx scripts/verify-roundtrip.ts  # 20-check end-to-end
pnpm typecheck
```

Consumers set:
```
PRINCIPE_UPDATES_URL=https://github.com/omergrossman/principe-feed/releases/download/latest
PRINCIPE_UPDATES_PUBLIC_KEY=<hex ed25519 public key>
```
