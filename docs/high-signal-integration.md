# Reddit Insights → High Signal

## Product boundary

Reddit Insights owns the single canonical forward collector, roster, schema,
private R2 archive, retention policy, deletion path, longitudinal analysis, and
research methodology. High Signal is a downstream consumer. It receives only
bounded, checksum-verifiable exports from Reddit Insights and holds neither raw
Reddit archives nor bucket credentials.

High Signal is the downstream synthesis product. It should consume only compact,
qualified Reddit observations and combine them with independent sources. It
must not ingest dashboard HTML, depend on the internal report schema, or treat a
Reddit observation as a publishable signal by itself.

## Version 1 handoff

Running the UI generator writes
`data/reddit-memory/<subreddit>-high-signal.json`. The envelope contains:

- `schemaVersion`, `source`, generation time, and community;
- collection range, post/comment counts, and available evidence kinds;
- a qualification warning for downstream consumers;
- deterministic candidate observations with metrics and canonical Reddit
  evidence URLs.

Version 1 exports directly source-backed high-engagement posts. Historical topic
shifts remain research findings in the dashboard until the analyzer can attach
representative post IDs to each topic-period observation. This avoids presenting
unrelated popular posts as evidence for a trend.

## Migration-only archive import

`npm run import:high-signal -- --events <events.jsonl.zst> --pointer <latest.json>
--output-dir <temporary-directory> [--render <subreddit>]` converts the bounded
daily event stream into derived gzip display corpora. The output declares its
exact archive window and `rawArchiveDuplicated: false`; it is disposable and
belongs under `artifacts/`, not the checked-in corpus. `--render` performs a
render-only UI build and exits without starting the local server.

This command supports the one-time move from the archive currently hosted by
High Signal. After cutover, it is a recovery tool rather than the normal data
direction. Its output remains disposable and expires within seven days.

## High Signal consumer contract

Reddit Insights publishes an authenticated latest manifest naming the newest
complete `events.jsonl.zst` export, its source window, schema version, coverage,
and SHA-256. High Signal downloads the export through Reddit Insights, verifies
the hash, imports the bounded attention events, and deletes the downloaded file
within seven days. It never reconstructs R2 object paths or receives R2 access.

## Qualified-finding handoff

The downstream adapter should:

1. Poll or receive completed export artifacts.
2. Upsert observations by their stable `id`.
3. Map mentioned entities using High Signal's existing entity resolution.
4. Cluster related observations across communities and time.
5. Seek independent corroboration from news, filings, GitHub, Hacker News,
   YouTube, or other relevant sources.
6. Apply High Signal's confidence, evidence, scoring, and publication rules.

Reddit-only evidence may inform exploration, brand perception, product
improvement, trend, or business-idea candidates. It does not satisfy High
Signal's two-source publication requirement.

## Comment evidence

Evidence items use `kind: "post" | "comment"`. A report without comment data
declares `evidenceKinds: ["post"]`; no placeholder comments are emitted. When
stored comment bodies are detected, coverage reports their stored-body count
separately from Reddit's post-level aggregate reply counts and declares
`evidenceKinds: ["post", "comment"]`. Reply-level observations can enter the
same envelope without changing version 1.

Useful future comment-derived observations include:

- repeated answers and workaround consensus;
- disagreement or polarization around a topic;
- expert explanations that outperform the original post;
- recurring product complaints and requested improvements;
- vocabulary migration from specialist communities into mainstream ones;
- changes in reply depth, response latency, and question resolution.

## Higher-value analysis enabled by the corpus

- **Community lead/lag:** which subreddits discuss a theme first and where it
  spreads next.
- **Trend lifecycle:** emergence, acceleration, saturation, decline, and revival.
- **Narrative divergence:** how the same entity or event is framed by different
  communities.
- **Persistent unmet needs:** complaints or questions that survive multiple eras.
- **Vocabulary evolution:** terms, products, and concepts entering or leaving
  common use.
- **Behavioral change:** participation, engagement, moderation proxies, and
  answer patterns over time.
- **Historical backtesting:** whether earlier Reddit observations preceded later
  developments captured by High Signal.
