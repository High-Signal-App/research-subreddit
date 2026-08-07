# Reddit Insights

Ingest, analyze, and visualize Reddit subreddit activity.

## Setup

```bash
npm install
```

## Usage

Run the full pipeline for a subreddit:

```bash
node scripts/reddit-memory-run.mjs LocalLLaMA
```

Or run each step separately:

```bash
# Ingest posts and comments
node scripts/reddit-memory-ingest.mjs LocalLLaMA new 1000

# Analyze and generate reports
node scripts/reddit-memory-analyze.mjs LocalLLaMA

# Serve the dashboard
node scripts/reddit-memory-ui.mjs LocalLLaMA
```

Open `http://localhost:7424` after the UI step.

## Project layout

- `scripts/reddit-memory-ingest.mjs` — fetch posts and comments via Reddit API
- `scripts/reddit-memory-analyze.mjs` — cluster topics, tone, engagement, moderation, and generate reports
- `scripts/reddit-memory-ui.mjs` — build and serve the static dashboard
- `scripts/reddit-memory-run.mjs` — orchestrate ingest → analyze → UI
- `scripts/reddit-proxy/` — Cloudflare Worker proxy for Reddit API
- `config/topic-anchors.json` — default topic anchors
- `data/reddit-memory/` — stored posts, reports, and embeddings cache

## Configuration

Customize topic anchors per subreddit by creating `data/reddit-memory/<subreddit>-anchors.json`.

## Notes

- The first analysis run downloads embedding models and caches embeddings in `data/reddit-memory/cache/`.
- The proxy worker is optional; use it if you need to route Reddit API calls through Cloudflare.
