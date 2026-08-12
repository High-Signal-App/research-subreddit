# Enrich Relevant Communities

`scripts/enrich-relevant-communities.mjs` prioritizes and enriches raw subreddit
corpora using the existing analyzer (`reddit-memory-analyze.mjs`). It does not
ingest Reddit data or fetch comments. The analyzer may download its embedding
model when the local model cache is absent.

## Selection logic

Candidates are raw corpus files (`<subreddit>.json`) found in `--data-dir`
(default `<repo>/data/reddit-memory`). The following are excluded:

- `cache/` and any subdirectory
- `*-high-signal.json` (High Signal exports)
- `*-report.json`, `*-report-<N>d.json`, `*-report.html` (generated reports)
- `*-anchors.json` (topic anchor overrides)

A community is only a candidate if it appears in **`RELEVANCE_COHORT`** at the top
of the runner. Relevance is an editorial judgment, not an objective fact — edit
that map to change what gets prioritized. Each entry has a `tier` (1 = highest
relevance) and a human-readable `reason`.

Ranking score (higher = enriched sooner):

```
score = tierWeight * 1000 + readiness
tierWeight = (MAX_TIER - tier + 1)        // tier 1 dominates
readiness  = postsScore + bodyScore + monthsScore   // 0..100
  postsScore  = min(posts, 2000) / 2000 * 30
  bodyScore   = bodyCoverage * 40          // fraction of posts with selftext
  monthsScore = min(representedMonths, 60) / 60 * 30
```

Tier dominates ordering; readiness breaks ties within a tier and surfaces corpora
that are too thin to be worth analyzing (use `--min-posts` to cut them).

## Commands

Audit the priority queue (read-only, safe against any data dir):

```bash
node scripts/enrich-relevant-communities.mjs --list
# Audit a specific corpus dir, e.g. the fleet source (read-only):
node scripts/enrich-relevant-communities.mjs --list \
  --data-dir=/Users/sarthak/Desktop/fleet/reddit-insights/data/reddit-memory
```

Preview the planned analyzer commands without running them:

```bash
node scripts/enrich-relevant-communities.mjs --dry-run --limit=10
```

Enrich the top N ready communities (writes reports into `--data-dir`):

```bash
node scripts/enrich-relevant-communities.mjs --limit=10 --min-posts=200
```

Enrich specific communities, re-enriching even if a report exists:

```bash
node scripts/enrich-relevant-communities.mjs LocalLLaMA ChatGPT --force
```

## Safety behavior

- Skips communities that already have a `<sub>-report.json` unless `--force`.
- Runs the analyzer sequentially; a single failure does not stop the batch.
- Prints a deterministic summary (enriched / failed / skipped) at the end.
- Refuses to execute when `--data-dir` does not end in `data/reddit-memory`
  (the analyzer reads
  `<cwd>/data/reddit-memory/<sub>.json`, so the runner sets cwd accordingly).
- Never deletes files, fetches data, collects comments, or writes outside
  `--data-dir`.

Generated reports and embedding caches are written beside the selected corpora.
Use `--list` or `--dry-run` when the data directory should remain read-only.

## Tests

```bash
node scripts/enrich-relevant-communities.test.mjs
```

Uses a temporary fixture dir and a fake analyzer; no models or network.
