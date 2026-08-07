## Repository operating rules

This repository is independently operable. Run commands from the project root.

## Project

- **Stack**: Node.js ES modules, `@huggingface/transformers`, vanilla HTML/SVG dashboard.
- **Local dev**: `npm install` then `node scripts/reddit-memory-run.mjs <subreddit>`.
- **Check**: Run the full pipeline and verify `http://localhost:7424` serves the dashboard.
- **Deploy**: Manual; no automatic production deploy.

## Work tracking

- Use GitHub Issues for operational work tracking.
- `PROJECT_STATUS.md` holds durable shipped/current product truth if the project grows.

## Scope

**In scope:** Reddit subreddit ingestion, analysis, and dashboard visualization.
**Out of scope:** ChatGPT memory insights, general social-media ingestion, hosted accounts.

## Notes

- Cache and generated reports live in `data/reddit-memory/` and are gitignored.
- Topic anchors can be customized per subreddit via `data/reddit-memory/<subreddit>-anchors.json`.
