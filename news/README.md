# News center — authored updates

This is the **single source** for Príncipe product news. One source, two channels:

- **App** → news items ride the signed knowledge-feed bundle and show in the in-app "What's New" center on every instance.
- **Web** → `scripts/build-news.mjs` derives `news.json` (repo root), which the marketing site (`principe.cloud`) reads and renders at the top + on `/news`.

## Authoring

Edit `news/items.json` (or use the **News card in the Feed Console**). Each item:

```json
{
  "id": "kebab-case-slug",          // stable, unique
  "date": "2026-06-20",             // YYYY-MM-DD
  "tag": "feature",                  // feature | calibration | security | release | research | tip
  "channel": "both",                 // app | web | both
  "title": "Headline",
  "summary": "One-line teaser (optional; first body line is used if omitted).",
  "body": "Full markdown body. **Bold**, links, paragraphs.",
  "link": "https://… (optional external link)"
}
```

Items are **operator-authored and published verbatim** — they do NOT pass through the LLM distiller or the legal/verbatim gate (those are for scraped third-party content, not our own announcements).

## Publish

- A push that changes `news/items.json` triggers `.github/workflows/news.yml`, which runs `build-news.mjs` and commits a fresh `news.json`.
- `news.json` on `main` is what the website fetches (via its `/api/news` Function, cached).
- App delivery (news inside the signed bundle) is wired in the daily/publish pipeline.

## Channels

- `web` → website only · `app` → in-app only · `both` → everywhere.
- The web view (`news.json`) includes `web` + `both`. The app bundle includes `app` + `both`.
