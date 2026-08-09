# static-pages-export Specification

## Purpose
TBD - created by archiving change deploy-static-cloudflare-pages. Update Purpose after archive.
## Requirements
### Requirement: Static community routes

The build SHALL produce a self-contained HTML route for every community listed in the compact display index.

#### Scenario: Build all collected communities

- **WHEN** the Pages build runs with the compact artifacts present
- **THEN** `dist/r/<subreddit>/index.html` exists for every indexed community
- **AND** `dist/index.html` provides a default observatory

### Requirement: Minimal deployed data

The Pages output SHALL omit raw corpora, compact source artifacts, reports, caches, embeddings, and High Signal exports.

#### Scenario: Inspect the output

- **WHEN** the static build completes
- **THEN** the output contains rendered HTML and Pages metadata only

### Requirement: Static navigation

Community selection SHALL navigate directly between generated static community routes without requiring a server function.

#### Scenario: Select another community

- **WHEN** a visitor selects a collected community
- **THEN** the browser opens its `/r/<subreddit>/` route
