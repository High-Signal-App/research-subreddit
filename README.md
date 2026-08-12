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

Build the deployable display corpus for every collected community:

```bash
npm run build:display
npm run test:display
```

The generated `data/reddit-display/*.json.gz` files contain only fields used by
the observatory. Set `REDDIT_DISPLAY_DIR` when serving them from another path;
`REDDIT_DATA_DIR` may point to an empty writable directory in display-only
deployments.

## Cloudflare Pages

The public observatory is exported as static HTML. It does not require Pages
Functions or a deployed database.

```bash
npm run build:pages
```

Configure the Pages project with:

- Build command: `npm run build:pages`
- Build output directory: `dist`
- Node.js: 22 or newer

The build creates `/r/<subreddit>/` for every active community in the curated roster.
Only `dist/` is uploaded; raw corpora, reports, caches, embeddings, and
compact build inputs remain outside the deployed output.

The visible community roster is curated in `config/community-roster.json`.
Excluding a community removes it from navigation and static export without
deleting its compact or raw research data.

## Project layout

- `scripts/reddit-memory-ingest.mjs` — fetch posts and comments via Reddit API
- `scripts/reddit-memory-analyze.mjs` — cluster topics, tone, engagement, moderation, and generate reports
- `scripts/reddit-memory-ui.mjs` — build and serve the static dashboard
- `scripts/reddit-memory-run.mjs` — orchestrate ingest → analyze → UI
- `scripts/enrich-relevant-communities.mjs` — rank and batch-enrich ready corpora without new Reddit ingestion
- `scripts/build-display-data.mjs` — generate gzip-compressed display artifacts for every collected community
- `scripts/build-pages.mjs` — pre-render the observatory for Cloudflare Pages
- `scripts/topic-clustering.performance.test.mjs` — guard topic summarization cost and output at representative corpus sizes
- `scripts/reddit-proxy/` — Cloudflare Worker proxy for Reddit API
- `config/topic-anchors.json` — default topic anchors
- `data/reddit-memory/` — stored posts, reports, and embeddings cache

## Configuration

Customize topic anchors per subreddit by creating `data/reddit-memory/<subreddit>-anchors.json`.

## Notes

- The first analysis run downloads embedding models and caches embeddings in `data/reddit-memory/cache/`.
- The proxy worker is optional; use it if you need to route Reddit API calls through Cloudflare.
