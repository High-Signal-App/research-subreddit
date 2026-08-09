## Purpose

Provide a responsive longitudinal research workspace for understanding how Reddit communities and their discussions evolved over time.

## ADDED Requirements

### Requirement: Community and period selection
The workspace SHALL provide searchable selection for every collected subreddit, SHALL render an immediate lightweight historical view directly from raw posts when an enriched report is absent, and SHALL preserve a compatible selected period when switching communities.

#### Scenario: Switch subreddit
- **WHEN** the user selects another available subreddit
- **THEN** the workspace renders that community from its collected dataset and keeps the current period

#### Scenario: Missing selected period
- **WHEN** the selected subreddit has no report for the current period
- **THEN** the workspace falls back to its all-time report and discloses the fallback

### Requirement: Authored research controls
The workspace SHALL provide an authored searchable community picker and SHALL
present shorter research windows as a secondary focus lens rather than as an
equally weighted browser-native selector.

#### Scenario: Change the research focus
- **WHEN** the user selects a shorter focus window
- **THEN** the workspace preserves the selected community, clearly identifies
  the active focus, and transitions to the compatible report without exposing
  ambiguous period labels

### Requirement: Visualization-led research story
The workspace SHALL lead with a temporal topic visualization and exactly three prioritized findings before secondary operational metrics.

#### Scenario: Open a report
- **WHEN** a report contains historical evolution data
- **THEN** the first viewport presents its date range, topic trajectory, three strongest changes, coverage context, and evidence access

#### Scenario: Continue beyond the lead findings
- **WHEN** more than three supported topic movements exist
- **THEN** the section following the opening presents additional ranked
  movements and does not repeat the same three lead findings

### Requirement: Community observatory
The workspace SHALL provide an exploratory topic-by-time view after the guided findings without inventing unsupported causal or network relationships.

#### Scenario: Explore the broader record
- **WHEN** the user opens the observatory
- **THEN** the workspace exposes topic and time structure using only relationships present in the report data

#### Scenario: Inspect topic attention and momentum
- **WHEN** the user switches to the secondary observatory view
- **THEN** each topic is positioned by labeled volume and conversation-share
  change axes, with persistence encoded explicitly and no implied network

### Requirement: Post-only signal deck
The workspace SHALL progressively expose post-derived tone, reach/approval,
and contributor participation views when those report fields are available.

#### Scenario: Explore another signal
- **WHEN** the operator chooses a signal-deck tab
- **THEN** exactly one legible analytical view is shown with its metric meaning
  and corpus limitation visible

### Requirement: Content intelligence signals
The workspace SHALL expose post-derived views for repeated language, emerging
language, topic attention quality, content formats, and expanded language-tone
markers when the underlying report contains sufficient observations.

#### Scenario: Inspect repeated content
- **WHEN** enough post titles are available
- **THEN** the workspace ranks normalized repeated words and phrases by the
  number and share of distinct posts containing them

#### Scenario: Inspect emerging content
- **WHEN** posts span an earlier and later temporal half
- **THEN** the workspace ranks supported words or phrases by per-post prevalence
  lift and discloses both earlier and later rates

#### Scenario: Inspect topic performance
- **WHEN** posts have topic, score, and upvote-ratio assignments
- **THEN** the workspace displays topic volume beside attention and approval
  metrics without presenting engagement as quality or causality

#### Scenario: Inspect richer tone
- **WHEN** post-language emotion markers are available
- **THEN** the workspace shows multiple named lexicon categories over time and
  explains that they are language-pattern classifications

### Requirement: Month-over-month content signals
Content-intelligence views SHALL expose month-level change when at least two
represented months are available.

#### Scenario: Inspect a ranked phrase, topic, or flair
- **WHEN** a ranked content row has observations across multiple months
- **THEN** the row includes a month-level prevalence trajectory with its date
  range and accessible summary

#### Scenario: Inspect monthly platform attention
- **WHEN** scored posts span multiple months
- **THEN** the workspace shows separate monthly trajectories for post volume,
  median score, and average upvote ratio without combining their scales

### Requirement: Random-community research audit
Each material signal-model expansion SHALL be checked against at least one
randomly selected collected community in addition to the enriched reference
community.

#### Scenario: Audit a collection-only community
- **WHEN** the selected random community lacks topic enrichment
- **THEN** the audit inventories all available fields, verifies applicable
  signals and omissions, and records product improvements without fabricating
  topic evolution

### Requirement: Responsive analytical figures
Analytical figures SHALL remain legible at 390, 768, and 1440 CSS pixels without forcing the whole page to overflow horizontally.

#### Scenario: Narrow viewport
- **WHEN** the workspace is rendered at 390 CSS pixels
- **THEN** controls, figures, labels, and evidence content remain reachable and the document has no page-level horizontal overflow

### Requirement: Evidence access
Important findings SHALL expose supporting source posts when source URLs exist and SHALL distinguish interpretation from observed data.

#### Scenario: Inspect a finding
- **WHEN** a user opens the evidence associated with a historical finding
- **THEN** the workspace shows source-linked records and the coverage context used by the interpretation

### Requirement: Finding confidence and source evidence
Each historical topic finding SHALL disclose its support, temporal persistence,
corpus coverage, and whether the movement is higher, lower, or steady across the latest represented periods.

#### Scenario: Read a topic movement
- **WHEN** a ranked topic finding is rendered
- **THEN** it shows a plain-language High / Medium / Low corpus-coverage grade based on represented-time
  coverage and matched-post volume, plus peak period and persistence

#### Scenario: Inspect topic evidence
- **WHEN** a topic finding has assigned posts with canonical Reddit permalinks
- **THEN** its evidence disclosure links directly to representative matched
  posts and labels the ranking method used to select them

#### Scenario: Sparse historical coverage
- **WHEN** calendar coverage or matched-post support is insufficient
- **THEN** the workspace labels the finding exploratory and does not present
  its magnitude as a high-confidence historical conclusion

### Requirement: Post-corpus research boundary
The workspace SHALL exclude comment-derived analysis from the active interface in this iteration while preserving comment data for future work and downstream contracts.

#### Scenario: Open any community
- **WHEN** a collected community is rendered
- **THEN** the visible research story uses posts as the common evidence layer and makes no comment-derived claim

### Requirement: Ranked historical canon boundary

The workspace SHALL describe older ranked records as a historical canon and
SHALL NOT use the mixed corpus to estimate total monthly activity or whole-
conversation prevalence.

#### Scenario: Open an enriched community
- **WHEN** the report contains mixed recent and ranked historical records
- **THEN** the opening names the Historical Canon and Recent Candidate Pool,
  identifies the inferred boundary, and explains that prominence is not completeness

#### Scenario: Inspect historical time
- **WHEN** canon records are distributed across months or years
- **THEN** the workspace shows represented prominent posts and evidence density,
  not total community volume or inferred activity growth

### Requirement: Recent contenders

The workspace SHALL identify recent posts outperforming comparable recent posts
using age-aware relative engagement and SHALL keep them separate from the
historical canon.

#### Scenario: Inspect what is winning now
- **WHEN** enough newest-post candidates exist
- **THEN** the workspace ranks recent contenders, states the recent cohort and
  maturity rule, and links to canonical Reddit sources

### Requirement: Now-versus-canon synthesis

The workspace SHALL compare topic and content patterns between the recent
candidate pool and ranked historical canon without treating either as a census.

#### Scenario: Compare present candidates with the canon
- **WHEN** both lenses contain sufficient records
- **THEN** the workspace identifies durable winners, emerging contenders,
  fading canon, saturation, and undersupplied attention with transparent counts
  and representative posts

### Requirement: Credibility-first visualization boundary

The workspace SHALL omit visualizations whose interpretation depends on complete
historical collection and SHALL keep sample diagnostics distinct from community
behavior.

#### Scenario: Inspect historical canon years
- **WHEN** ranked historical records span multiple years
- **THEN** the workspace shows represented year, leading detected topic, and sample size without encoding sample density as community activity or comparing scores across years

#### Scenario: Inspect corpus diagnostics
- **WHEN** the operator reaches source evidence
- **THEN** posting-time patterns are omitted and platform-response distributions are explicitly limited to the collected ranked sample

#### Scenario: Explore language patterns
- **WHEN** repeated and emerging language are both available
- **THEN** they appear as one progressively disclosed content-pattern lens rather than competing top-level views
