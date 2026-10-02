# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the Fleet operator inspecting a subreddit on a given
collection day, and anyone receiving that snapshot. They need source-linked
captured posts, retained discussion, clear coverage and downloadable data.

## Product Purpose

Reddit Insights helps people inspect and share captured subreddit/day evidence
through a date-addressable snapshot with source links and reconciled downloads.
Its date identifies a collection with an explicit UTC window; it is not a
historical front-page reconstruction or a complete conversation census.

The snapshot feature is implemented locally. The public product currently
remains the historical top-content observatory; production archive access,
derivative refresh/removal and deployment still need qualification.

The workspace sends qualified data to High Signal. It is not a replacement for
High Signal's cross-source synthesis or Daily Brief.

## Positioning

Lead with a direct community/date lookup, then captured evidence and open
sharing. The existing mixed ranked/recent corpus remains a separate historical
research lens with its original sampling limits.

## Operating Context

The operator imports a hash-verified v2 archive with native Zstandard and opens
Snapshot Studio at `http://127.0.0.1:7425/`, with the reader at `/snapshots/`. Minimized private
derivatives live in gitignored `artifacts/daily-snapshots/` and expire for serving
after 24 hours. The historical local research viewer remains on port 7424.

## Capabilities and Constraints

- Ingest subreddit posts and comments and retain source-level provenance.
- Analyze topics, activity, engagement, tone, repeated questions, and comment
  patterns across multiple time windows.
- Compare communities and historical periods using consistent metrics and
  clearly disclosed coverage.
- Keep every collected community immediately searchable and explorable; richer
  analysis artifacts deepen the view but do not determine whether a dataset is
  considered ready.
- Ship a compact display corpus for every readable community while keeping raw
  Reddit payloads and embeddings outside the deployable product surface.
- Grade available product material as strong, limited, or sparse without
  presenting those grades as statistical confidence or historical completeness.
- Surface durable canon themes, emerging contenders, fading historical winners,
  saturated current patterns, vocabulary shifts, and attention outliers.
- Never use the mixed ranked/recent corpus to estimate total historical activity
  or whole-conversation topic prevalence.
- Support subreddit-specific topic anchors.
- Remain independently operable and local-first.
- Keep one private canonical forward archive. It currently runs in High Signal;
  ownership migration is a separate planned step. Consumers use bounded exports
  without raw bucket credentials or retained raw copies.
- Treat High Signal as a downstream consumer of qualified, structured findings,
  not raw corpus data or dashboard-specific report objects.
- Preserve High Signal's evidence-first contract: a Reddit finding is one source
  observation and does not become a publishable cross-source signal by itself.
- Show retained comment evidence in daily snapshots, distinguish retained counts
  from reported replies, and disclose filtering, failures and unresolved branches.
- Do not expand into general social-media ingestion or ChatGPT memory insights.

## Evidence on Hand

The compact historical display corpus and generated reports remain available.
Local raw corpora and embeddings were moved reversibly to Trash on October 2.
Two downloaded real daily archive batches (September 30 and October 1) qualify
the local snapshot path; they are temporary evidence, not the production store.

## Product Principles

- Lead with community/date selection, exact collection coverage and captured
  evidence, then sharing and downloads.
- Keep every important conclusion traceable to Reddit source evidence.
- Separate corpus exploration from downstream signal publication.
- Make data quality, coverage, and uncertainty visible.
- Prefer a compact export contract over coupling High Signal to internal reports.

## Accessibility & Inclusion

The research workspace must remain usable with keyboard navigation, visible
focus states, semantic controls, non-color status cues, and responsive layouts
for narrow and wide screens.
