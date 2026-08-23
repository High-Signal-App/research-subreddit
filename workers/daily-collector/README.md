# Daily Reddit collector

This Worker is future infrastructure. It is not deployed and no R2 bucket has
been provisioned.

Once activated, it requests the newest 100 posts from every configured
subreddit at 02:17 UTC daily and writes:

- `snapshots/YYYY-MM-DD/<subreddit>.json.gz`
- `runs/YYYY-MM-DD.json`

Snapshots use the same minimal post projection as the observatory. They do not
contain comments or unused Reddit response fields. Daily keys are deterministic,
so rerunning the same UTC date replaces rather than duplicates that snapshot.

## Activate later

1. Review `communities.js` and remove communities you do not want to collect.
2. Create the Standard-class bucket:
   `npx wrangler r2 bucket create reddit-insights-archive`
3. Add secrets interactively from this directory:
   `npx wrangler secret put REDDIT_CLIENT_ID`
   and `npx wrangler secret put REDDIT_CLIENT_SECRET`.
4. Validate with `npm run check:collector`.
5. From the repository root, explicitly deploy with
   `npm run deploy:collector`, which deploys with the immutable Git SHA tag.

Cloudflare may require enabling an R2 subscription even while usage remains
inside its free allowance.

## Expected envelope

At the current 93-community roster, the design makes 93 Reddit listing requests
and about 94 R2 writes per day. Actual storage depends on post-body size and
compression; inspect the first week before choosing permanent retention.

## Rate limiting

Reddit reports its remaining per-window call budget in `X-Ratelimit-Remaining`
and `X-Ratelimit-Reset`, both in seconds. The collector:

- honours `Retry-After` on a 429 instead of applying its own backoff, so a
  throttled run waits exactly as long as Reddit asks;
- pauses at a batch boundary once fewer than 5 calls remain in the window,
  rather than pushing the remaining batches into 429s;
- caps any single wait at 60s so one backoff cannot consume the scheduled run;
- fails a subreddit immediately on 400/401/403/404/410/451 — private, banned,
  or deleted communities answer the same way on every attempt, so retrying
  them only spends budget that working communities need;
- retries the OAuth token on a transient failure, because every community in
  the run depends on that one call, but aborts at once on bad credentials.

Each run manifest records `rateLimit.remaining`, how many waits were taken, and
total time waited. `permanentFailures` counts communities that need a roster fix
rather than a re-run.

## Retention

Snapshots are immutable per UTC date and deterministic per key, so retention is
purely an R2 lifecycle decision. Choose one before activation:

| Option | Rule | Use when |
| --- | --- | --- |
| Keep everything | no lifecycle rule | the corpus is the product and storage stays inside the free allowance |
| Rolling window | expire `snapshots/` after 90 or 180 days | you only need recent forward-looking sampling |
| Thin the tail | expire `snapshots/` after 30 days, keep `runs/` indefinitely | you want the audit trail of what ran without the payloads |

`runs/` manifests are small; keeping them permanently preserves a record of
collection history even where snapshots have expired. Set the rule with
`npx wrangler r2 bucket lifecycle add`, and set it *before* activation so no
snapshot is ever stored under a policy you did not choose.
