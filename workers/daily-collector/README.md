# Daily Reddit collector

This Worker is an undeployed reference scaffold. The final
[product requirements](../../PRD.md) make Reddit Insights the sole owner of the
production collector and compressed raw archive. High Signal becomes a bounded
export consumer.

When run in a bounded diagnostic environment, it requests the newest 100 posts
from every configured subreddit and writes:

- `snapshots/YYYY-MM-DD/<subreddit>.json.gz`
- `runs/YYYY-MM-DD.json`

Snapshots use the same minimal post projection as the observatory. They do not
contain comments or unused Reddit response fields. Daily keys are deterministic,
so rerunning the same UTC date replaces rather than duplicates that snapshot.

## Activation gate

Do not activate this scaffold as the replacement collector. First port the
proven cross-community Zstandard packing, exact-window pagination, comment
filtering, resume, verification, and redaction behavior. The migration must stop
the High Signal writer before the Reddit Insights writer starts. Provisioning
resources, setting secrets, migration, deletion, and deployment remain explicit
operator actions.

## Expected envelope

At the current 93-community reference roster, the scaffold would make 93 Reddit
listing requests and about 94 R2 writes per day. The Reddit Insights production
design instead packs all 99 launch communities into daily cross-community
Zstandard streams, avoiding per-community raw objects.

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

Diagnostic output from this scaffold is temporary and must be removed within 48
hours. The replacement collector applies the PRD's 365-day lifecycle and
deletion rules to the sole `reddit-insights-archive` bucket.
