# Reddit Insights

Inspect captured subreddit activity by collection date, share a snapshot and
download its posts and retained comments. Historical research views remain available.

Product direction: [product requirements](PRD.md).

## Setup

```bash
npm install
```

## Usage

Open Snapshot Studio at https://reddit-insights.highsignal.app/;
[issue #21](https://github.com/High-Signal-App/research-subreddit/issues/21)
records release acceptance. To run locally, prepare a verified daily v2 archive
directory, then start the viewer:

```bash
npm run snapshots:import -- --archive-dir /path/to/daily-archive
npm run snapshots:ui
```

Open `http://127.0.0.1:7425/` for Snapshot Studio; `/snapshots/` opens the reader. Repeat the import for additional dates.
Direct lookup uses `/r/AI_Agents/2026-10-01/`. Copy snapshot link adds a short
version path, for example `/r/AI_Agents/2026-10-01/a375b450cf23/`, to preserve
the exact captured revision. Earlier query-string links still work and normalize
to the clean path; full run/revision identity remains in exports.
The directory must contain `manifest.json`, `subreddits.index.json`, and the
posts/comments/events `.jsonl.zst` packs. Native `zstd` must be installed on the
trusted import runner. The importer verifies all pack/index SHA-256 receipts,
line/byte partitions, identities, collection windows and counts before creating
minimized gzip derivatives in gitignored `artifacts/daily-snapshots/`.

The date is the **collection date**, with its exact half-open UTC window shown.
Comments are filtered, and scores/reply totals are recorded at capture time.
Author/profile metadata is omitted; text may still mention people. JSON includes
coverage; both CSV files include collection identity and safely quote text.
Search filters the viewer; downloads contain the whole selected snapshot.

“What stood out” summarizes the highest recorded score, most reported replies,
median score, low-score count and post-label mix, with links to the evidence.
Removed posts are excluded. These are captured-record observations, not inferred
topics or sentiment. Previous captured-post counts are compared only for complete,
uncapped, non-redacted 24-hour windows aligned within one minute. Filtered comment
counts are not compared because their filter-policy provenance is absent.

Share URLs resolve the full source identity from a unique 12-character revision
prefix; ambiguous prefixes fail explicitly. Exports expire after 24 hours and
must be refreshed from the authoritative private archive. Re-importing a redacted
run replaces its catalog entries; old revisions become unavailable even if old
files remain on disk. Removing a catalog entry revokes access immediately.
Responses use `no-store`. Expired files are not automatically deleted; retention
and upstream redaction refresh must be wired before production use. Import into
one private directory with a single writer, never directly into `dist/`.

```bash
npm run test:snapshots
```

### Historical research pipeline

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

The build exports the snapshot shell at `/` and `/snapshots/`, and preserves
static historical research pages at `/r/<subreddit>/`. Historical pages work
without a database. The new snapshot API requires Pages Functions and a private
R2 binding named `SNAPSHOT_EXPORTS`; absent storage is an explicit unavailable state.

The adapter reads only `reddit-insights/exports/v1/index.json` and catalogued
minimized derivatives beneath that prefix. It does not read or publish the raw
archive. `wrangler.jsonc` binds the existing private derivative bucket.

`node scripts/publish-snapshots.mjs --refresh-only` discovers the canonical
complete collection, verifies source packs when changed, uploads minimized gzip
objects, verifies readback and commits the catalog last. Initial publication
requires `--initialize`; verified historical packs may be added with repeated
`--archive-dir` arguments. High Signal's collection and redaction workflows
serialize publication using the same concurrency group. Unchanged sources renew
their 24-hour serving lease only after rereading the authoritative manifest.
Active objects are retouched after five days; a seven-day lifecycle rule covers
only obsolete derivative objects, excluding the catalog and raw archive.
Source tests and a local Cloudflare runtime check qualify the binding adapter;
release acceptance still requires anonymous live routes and download checks.

```bash
npm run build:pages
```

Configure the Pages project with:

- Build command: `npm run build:pages`
- Build output directory: `dist`
- Node.js: 22 or newer

The build creates `/r/<subreddit>/` for every active community in the curated roster.
`dist/` contains static assets; Pages Functions are built separately from `functions/`.
The static output includes the curated communities’ compact gzip
search chunks under `/data/`, containing the collected post titles, bodies and
source links used by browser search. Raw research directories, reports, caches
and embeddings remain outside the deployed output; excluded communities are
not copied into the public search bundle.

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

### Optional proxy endpoint health

The Reddit proxy can send aggregate endpoint measurements to App Health when its optional `APP_HEALTH_INGEST_KEY` binding is configured. Events use the fixed `/health` label for the root health check and `/proxy` for all proxied Reddit paths; they contain only method, route label, status, duration, and the SDK-generated timestamp. `OPTIONS` preflight is excluded. Subreddit and post paths, search terms, query values, headers, cookies, credentials, and request or response bodies are never sent. With no ingestion key, no telemetry client is created and no event is sent. This support does not enable or deploy the proxy, or activate the separate daily-collector scaffold.


### Shareability repair — 2026-09-07

Community navigation now binds only to picker buttons. The post-search panel
also carries `data-community`; binding the whole panel caused clicks inside it
to navigate and reset the query. A regression test exercises the actual click
binding and confirms that the panel stays inert while picker navigation works.
Contender age bands are now explicitly dated to the latest collected post,
rather than presented as current ages.

The repair is deployed at source `4e63e2b4abbefda34981e45d5dad35cc33c3b794`.
[Release acceptance](docs/release-2026-09-07.md) records matching custom-domain
assets, retained search queries and source-linked results, keyboard community
selection, dated age bands, mobile layout, and a real unavailable-community
HTTP 404 with recovery. The 93-community export and all six exported search/
routing checks pass; exact source CI is green.

Independent public web access resolved the sampled original Reddit permalink
and matched its title, topic and visible opening excerpt against the retained
mobile screenshot. The headless-browser network block is recorded separately. Scoped historical source-linked discovery
is qualified as an experiment with medium confidence. Missing capture/retrieval
provenance and unaudited full-corpus fidelity still limit longitudinal claims.
Preserve inactive status: no new collection, enrichment, proxy/collector deployment
or database work is implied by this static release.
