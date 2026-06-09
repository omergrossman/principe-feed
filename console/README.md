# Feed Console

A tiny **local** admin for the feed's manual inputs — add URLs + upload
files for the daily build to digest, see what's pending, and review recent
builds. Zero dependencies, binds to `127.0.0.1` only (no exposure, no
auth), and commits to this repo via the GitHub API with your token.

It's a separate tool on purpose — it manages *your* central feed, so it
lives here in the publisher repo, not in the distributed Príncipe app.

## Run it

1. Put your token in a gitignored `.env` at the repo root:
   ```
   FEED_GITHUB_TOKEN=github_pat_...   # fine-grained PAT, Contents: write on this repo
   # FEED_REPO=omergrossman/principe-feed   # optional, this is the default
   ```
2. Start it:
   ```
   pnpm console
   ```
3. Open **http://localhost:4747**.

Add a URL or drop a file → it commits straight into `manual/`. The next
daily build digests it (key points, never verbatim) and it rides the
normal email/PR approval before publishing. Change the port with
`CONSOLE_PORT`.
