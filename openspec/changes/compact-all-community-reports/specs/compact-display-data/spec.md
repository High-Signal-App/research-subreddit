# Compact display data

## ADDED Requirements

### Requirement: All-community display coverage

The system SHALL generate a display artifact for every readable raw subreddit corpus.

#### Scenario: Generate the full directory
- **WHEN** the builder runs against the corpus directory
- **THEN** every readable community receives one versioned compact artifact and the summary reports any skipped corpus

### Requirement: Minimal display payload

The display artifact SHALL contain only fields consumed by the observatory and SHALL omit unused Reddit API metadata and embeddings.

#### Scenario: Compact a raw post
- **WHEN** a raw Reddit post is converted
- **THEN** identity, source URL, time, title, bounded body text, score, reply count, approval ratio, flair, and optional topic are retained while unrelated API fields are omitted

### Requirement: Honest capability state

Every compact artifact SHALL identify whether the corpus supports strong, limited, or sparse product functionality without describing the grade as statistical confidence.

#### Scenario: Open a sparse community
- **WHEN** fewer than 500 records are available
- **THEN** the interface names the sparse source material and avoids canon-comparison claims requiring stronger support

### Requirement: Compact-first loading

The UI SHALL prefer the compact display artifact and retain existing enriched/raw fallbacks.

#### Scenario: Serve a generated community
- **WHEN** a compact artifact exists
- **THEN** the UI renders it without loading the larger raw corpus
