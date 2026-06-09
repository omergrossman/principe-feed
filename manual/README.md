# Manual feed inputs

Add your own URLs and files here to have them **digested** into the daily
knowledge package — the build extracts the key points (never the raw text)
and grounds the panel with them. No portal, no extra tools: the repo is the
inbox.

## Add a URL
Append it to [`urls.txt`](./urls.txt) (one per line). Edit it on github.com
or `git push`. The next daily build fetches + digests it and remembers it.

## Add a file
Drop it into [`inbox/`](./inbox/) — drag-and-drop on github.com (**Add file →
Upload files**) or `git push`. Supported: `.pdf`, `.txt`, `.md`, `.html`.
After the build digests it, the file is moved to `processed/` so it's
ingested once.

## What happens to them
- **Digested, not copied** — the distiller summarizes the key points; a
  programmatic check rejects anything too close to the source text.
- **Persistent** — manual items don't expire on the 30-day TTL (you curated
  them deliberately). Re-adding the same URL/file updates it in place.
- **Your own material** — manual inputs skip the public-source allowlist
  that scraped analyst content must pass, but are still digested + verbatim-
  checked.

The change rides the normal review flow: it shows up in the next daily brief
(PR / email) for you to approve before it publishes.
