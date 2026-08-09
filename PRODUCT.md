# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the Fleet operator researching how Reddit evolved across
communities and time. They use the workspace to compare eras, communities,
topics, language, questions, complaints, and behavioral shifts without losing
the source posts and comments behind them.

## Product Purpose

Reddit Insights is a standalone research workspace for ingesting, analyzing,
and exploring subreddit data. With the current mixed listing corpus, its
primary purpose is to show what communities historically rewarded and kept
visible, what wins attention now, and how the recent candidate pool differs
from the ranked historical canon. Whole-conversation evolution becomes a
separate future capability only when comparable observation data exists.

The workspace sends qualified data to High Signal. It is not a replacement for
High Signal's cross-source synthesis or Daily Brief.

## Positioning

Reddit Insights combines corpus-scale historical comparison with a traceable
path back to individual Reddit posts and comments. Its job is to make evolution
across time and communities visible while preserving the nuance and provenance
that a general cross-source intelligence product would otherwise flatten.

## Operating Context

The operator runs a local Node.js pipeline, reviews the generated research
workspace at `http://localhost:7424`, moves across time windows and communities,
compares historical periods, inspects transitions and outliers, and follows
findings back to source evidence. Generated reports and caches live under
`data/reddit-memory/`.

## Capabilities and Constraints

- Ingest subreddit posts and comments and retain source-level provenance.
- Analyze topics, activity, engagement, tone, repeated questions, and comment
  patterns across multiple time windows.
- Compare communities and historical periods using consistent metrics and
  clearly disclosed coverage.
- Keep every collected community immediately searchable and explorable; richer
  analysis artifacts deepen the view but do not determine whether a dataset is
  considered ready.
- Surface durable canon themes, emerging contenders, fading historical winners,
  saturated current patterns, vocabulary shifts, and attention outliers.
- Never use the mixed ranked/recent corpus to estimate total historical activity
  or whole-conversation topic prevalence.
- Support subreddit-specific topic anchors.
- Remain independently operable and local-first.
- Treat High Signal as a downstream consumer of qualified, structured findings,
  not raw corpus data or dashboard-specific report objects.
- Preserve High Signal's evidence-first contract: a Reddit finding is one source
  observation and does not become a publishable cross-source signal by itself.
- Treat comment evidence as an optional future layer. When comments are absent,
  disclose post-only coverage and do not imply that reply behavior was analyzed.
- Do not expand into general social-media ingestion or ChatGPT memory insights.

## Evidence on Hand

The repository contains real ingested subreddit corpora and generated JSON/HTML
reports under `data/reddit-memory/`. These artifacts provide the content used by
the dashboard and can support source-linked demonstrations without fabricated
product claims.

## Product Principles

- Lead with historical change and cross-community comparison, then expose
  supporting charts and raw detail.
- Keep every important conclusion traceable to Reddit source evidence.
- Separate corpus exploration from downstream signal publication.
- Make data quality, coverage, and uncertainty visible.
- Prefer a compact export contract over coupling High Signal to internal reports.

## Accessibility & Inclusion

The research workspace must remain usable with keyboard navigation, visible
focus states, semantic controls, non-color status cues, and responsive layouts
for narrow and wide screens.
