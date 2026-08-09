## Why

The product's purpose is to research how Reddit evolved across communities and
time, but the current generated dashboard is a long collection of fixed-width
single-subreddit charts and collapsed details. Historical transitions,
cross-community differences, and source evidence are hard to discover, while
several visualizations overflow or become unreadable at common viewport sizes.

## What Changes

- Replace the rejected Temporal Atlas with a Living Research Studio that joins
  a lead temporal visualization, a guided evidence-backed data story, and a
  playful Community Observatory.
- Defer cross-community comparison until aligned metrics and a trustworthy
  normalization model make it research-useful; keep period research within the
  selected community for now.
- Replace fixed-width chart behavior with responsive, accessible
  visualizations and useful tabular fallbacks.
- Add a compact command strip, three prioritized findings, story chapters,
  observatory exploration, period state, data coverage, confidence, and
  evidence drill-downs while preserving generated static HTML.
- Remove comments from the active research experience until coverage and
  analysis readiness justify a dedicated future layer.
- Replace page-like research-window navigation with a secondary focus lens,
  and replace browser-native selectors with an authored searchable command bar.
- Add a progressively disclosed signal deck for post tone, reach/approval, and
  contributor participation so more of the existing report is explorable
  without restoring dashboard density.
- Refocus the signal deck on content intelligence: repeated title language,
  newly emerging vocabulary, topic-level attention quality, content formats,
  and a richer post-language tone spectrum. Contributor ranking is removed from
  the primary interface.
- Expand the ranked finding model beyond the three first-viewport findings and
  stop repeating those same findings in the next section.
- Add month-over-month trajectories to content signals so repetition,
  emergence, topic attention, flair patterns, and platform response can be read
  as change rather than only aggregate rankings.
- Validate the research model against one randomly selected collected
  community (`r/recruiting` for this iteration) and use its complete field
  inventory to identify honest product improvements.
- Define a versioned, compact export contract for qualified Reddit observations
  that High Signal can ingest as one evidence source.
- Document qualification rules that keep raw Reddit data and dashboard-specific
  report objects out of High Signal.
- Preserve the existing ingestion/analyzer output and avoid changing the other
  agent's active corpus work.
- Reframe the workspace around the data the collector actually holds: a ranked
  historical canon plus a broad recent candidate pool. Remove census-like
  activity and prevalence claims that cannot survive that sampling boundary.
- Add a "Now versus the canon" synthesis that distinguishes durable winners,
  emerging contenders, saturation, and historically rewarded themes without
  implying complete historical coverage.

## Capabilities

### New Capabilities

- `research-workbench`: Responsive exploration of Reddit's evolution through a
  Research Studio, guided Data Story, Community Observatory, turning points,
  quality state, and source evidence.
- `high-signal-export`: A versioned downstream observation contract with
  provenance, qualification, idempotency, and explicit source limitations.

### Modified Capabilities

None. This repository has no existing local OpenSpec capabilities.

## Impact

- Primary implementation surfaces: `scripts/reddit-memory-ui.mjs` and
  `scripts/reddit-research-studio.mjs`.
- Generated reports under `data/reddit-memory/*-report.html` change when the UI
  generator runs; cached data and ingestion scripts remain untouched.
- Product and design context are recorded in `PRODUCT.md`, `DESIGN.md`, and the
  dashboard surface brief.
- A future High Signal adapter will consume the documented export contract, but
  this change does not modify, migrate, deploy, or configure the High Signal
  repository.
- No new production dependency is planned; charts remain repo-native HTML/SVG.
