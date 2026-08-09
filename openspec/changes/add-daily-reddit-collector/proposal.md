# Daily Reddit collection worker

## Why

The current observatory has an uneven historical corpus and cannot reconstruct complete past activity. A small forward-only collector would create reliable, consistently sampled daily evidence if the owner later chooses to enable storage.

## What Changes

- Add a disabled-by-default Cloudflare Worker package that can collect each tracked subreddit’s newest 100 posts once per day.
- Store a bounded, display-oriented gzip snapshot per community and a run manifest in R2.
- Keep Reddit credentials in Worker secrets and storage access behind an R2 binding.
- Add retry, rate-limit awareness, deterministic object keys, structured logs, and a read-only health endpoint.
- Document activation, estimated volume, retention options, and explicit provisioning steps.

## Out of scope

- Provisioning or deploying the Worker or R2 bucket.
- Backfilling historical Reddit data.
- Collecting comments.
- Automatically rebuilding or deploying the observatory.
