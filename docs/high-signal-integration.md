# Reddit Insights → High Signal

## Product boundary

Reddit Insights is the system of record for longitudinal Reddit research. It
owns raw collection, historical coverage, subreddit-specific topic models,
cross-period comparison, source inspection, and research methodology.

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

## Future High Signal adapter

The adapter should:

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
