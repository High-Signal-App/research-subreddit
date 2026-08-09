## ADDED Requirements

### Requirement: Consistent daily sampling

The collector SHALL request the newest bounded listing with the same limit for every configured community.

#### Scenario: Scheduled collection runs

- **WHEN** the daily Cron Trigger invokes the Worker
- **THEN** it requests at most 100 newest posts for each configured subreddit
- **AND** it records the collection timestamp and listing cursor metadata

### Requirement: Minimal durable snapshots

The collector SHALL store only fields needed for future longitudinal analysis and source inspection.

#### Scenario: A community request succeeds

- **WHEN** Reddit returns a valid listing
- **THEN** the Worker writes a gzip snapshot to a deterministic date/community R2 key
- **AND** the snapshot omits comments, author profiles, and unused API fields

### Requirement: Honest run accounting

The collector SHALL record partial failures without marking the run complete.

#### Scenario: One community fails

- **WHEN** at least one configured subreddit cannot be collected after retries
- **THEN** successful snapshots remain stored
- **AND** the manifest identifies every failed community and error category

### Requirement: Explicit activation

The repository SHALL NOT provision or deploy storage or the collector automatically.

#### Scenario: Owner is ready to activate

- **WHEN** the owner chooses to begin forward collection
- **THEN** they must create the R2 bucket, configure secrets, and explicitly deploy the Worker
