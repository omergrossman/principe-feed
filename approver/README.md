# approver — tap-to-approve Worker

A tiny Cloudflare Worker that merges (approve) or closes (skip) the daily-brief PR when you tap a signed magic link in the email — so you never open GitHub.

Security: links are HMAC-signed and expiring; a GET only shows a **confirmation page**, the actual merge happens on the POST from that page's button (so email link-prefetchers can't auto-publish).

## One-time setup

1. **Create a GitHub fine-grained PAT** — github.com/settings/tokens → *Fine-grained* → Repository access: only `principe-feed` → Permissions: **Pull requests: Read and write** → generate, copy.

2. **Deploy** (from this `approver/` dir):
   ```bash
   npx wrangler login                       # browser OAuth into Cloudflare (free)
   GH_TOKEN=<the PAT> \
   APPROVE_HMAC_SECRET=<value from the repo secret> \
   ./deploy.sh
   ```
   `deploy.sh` sets the two Worker secrets and deploys. It prints a `…workers.dev` URL.

3. **Tell the feed where the Worker lives:**
   ```bash
   gh secret set APPROVER_URL --repo omergrossman/principe-feed \
     --body 'https://principe-feed-approver.<your-subdomain>.workers.dev'
   ```

That's it. `APPROVE_HMAC_SECRET` must be **identical** here and in the repo's Actions secret — the Action signs the links, the Worker verifies them.

## Config
- `GH_REPO` (in `wrangler.toml`) — the repo whose PRs this approves.
- Secrets (`wrangler secret put`): `GH_TOKEN`, `APPROVE_HMAC_SECRET`.
