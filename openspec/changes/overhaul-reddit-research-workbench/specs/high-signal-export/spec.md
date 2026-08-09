## Purpose

Define a stable, evidence-first handoff through which High Signal can consume qualified Reddit observations without depending on internal dashboard report shapes.

## ADDED Requirements

### Requirement: Versioned observation artifact
The system SHALL generate a versioned JSON artifact containing qualified Reddit observations with stable identifiers, community, time range, observation type, metrics, confidence, coverage, and source evidence.

#### Scenario: Generate an export
- **WHEN** a subreddit report contains observations meeting the qualification rules
- **THEN** the system writes a deterministic artifact that a downstream adapter can ingest idempotently

### Requirement: Source provenance
Every exported observation SHALL contain at least one canonical Reddit source URL and SHALL identify whether each evidence item is a post or comment.

#### Scenario: Observation lacks source evidence
- **WHEN** a derived observation has no canonical source URL
- **THEN** it is excluded from the High Signal export

### Requirement: Optional comment evidence
The export SHALL accept post evidence today and optional comment evidence in the future without changing the observation envelope version.

#### Scenario: Comments unavailable
- **WHEN** the source report contains no comment evidence
- **THEN** the export declares post-only coverage and emits no synthetic comment evidence

### Requirement: High Signal qualification boundary
The export SHALL label each item as a Reddit source observation and SHALL not represent it as a corroborated or publishable High Signal signal.

#### Scenario: Downstream ingestion
- **WHEN** High Signal consumes an exported observation
- **THEN** it can apply its independent entity mapping, cross-source corroboration, scoring, and publication rules

