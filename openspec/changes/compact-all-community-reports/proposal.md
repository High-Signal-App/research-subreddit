# Compact all-community reports

## Why

The observatory can discover 113 raw corpora, but only five have enriched reports and the raw Reddit payloads occupy 1.29 GB. Shipping those payloads would waste storage and expose fields the product never reads. Sparse corpora also need an honest capability state instead of the same apparent analytical depth.

## What

- Generate a minimal, versioned display artifact for every readable subreddit corpus.
- Preserve only post fields required by the top-content observatory and source links.
- Carry optional topic assignments from enriched reports when canonical post identity matches.
- Grade display capability as `strong`, `limited`, or `sparse` from record support—not statistical confidence.
- Load compact artifacts first while retaining raw/report fallbacks for local research.
- Measure compact storage and verify representative communities across coverage tiers.

## Out of scope

- Fetching additional Reddit history.
- Claiming complete historical coverage.
- Deleting raw corpora or embedding caches.
- Comment-derived analysis.

## Deploy impact

Deployment can ship `data/reddit-display/` instead of the raw Reddit API payloads and embedding cache. Raw evidence remains local and recoverable.
