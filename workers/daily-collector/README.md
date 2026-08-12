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
5. Explicitly deploy with
   `npx wrangler deploy --config workers/daily-collector/wrangler.jsonc`.

Cloudflare may require enabling an R2 subscription even while usage remains
inside its free allowance. Set an R2 lifecycle rule before activation if you
want snapshots deleted after a fixed retention period.

## Expected envelope

At the current 94-community roster, the design makes 94 Reddit listing requests and about 95
R2 writes per day. Actual storage depends on post-body size and compression;
inspect the first week before choosing permanent retention.
