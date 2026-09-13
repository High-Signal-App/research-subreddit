# Reddit Insights — product requirements

Status: final product definition, 2026-09-13. The static observatory is shipped
and the canonical 99-community archive exists in High Signal. Continuous
acceptance and the full Reddit Insights consumer workflow still need current
verification.

## Product outcome

Reddit Insights gives researchers, product operators, Mentionpilot, and High
Signal one durable, evidence-linked Reddit dataset. An operator curates the
communities, the service collects a bounded daily window, and consumers search
or export the retained observations without scraping Reddit again.

The product succeeds when it can show how topics, language, activity, and
attention changed across communities while naming collection start dates,
missing periods, and sampling limits. It never presents the retained corpus as
a complete history of Reddit.

## Current product truth

- The repository already ships a static, source-linked observatory over 93
  active communities and a retained local research corpus.
- High Signal already owns the canonical forward archive for 99 communities in
  private R2. Reddit Insights imports its bounded event export and must not run
  a second raw collector or keep a second raw copy.
- The local Cloudflare collector is an unused scaffold. It is retained as
  reference code, not as an activation path.
- The existing corpus has mixed ranked and recent sampling. It supports the
  current Top-content Observatory, not claims about total historical activity.

## Users and workflows

The Fleet operator manages the roster, reviews run health and gaps, resumes
failures, and controls expansion. Researchers search a community and date
range, inspect source evidence, compare periods, and export a reproducible
slice. Reddit Insights and Mentionpilot consume approved private exports; High
Signal uses the same archive for its bounded attention events. Each consumer
applies its own product logic, and a Reddit observation remains one source, not
a corroborated signal.

The core workflow is:

1. Curate and validate communities.
2. Schedule one UTC collection window per community per day.
3. Store source records, dated observations, coverage, and failures
   idempotently.
4. Review freshness, gaps, volume, and cost before expanding the roster.
5. Search or export a bounded, reproducible dataset with source links and
   coverage metadata.

## Product decisions

### Access and activation

Collection uses Reddit's official OAuth Data API only. The product does not
scrape Reddit HTML, use unauthenticated endpoints, rotate client IDs to evade
limits, or collect private communities. The existing archive may operate only
while its use and retention remain approved and its deletion path can remove
deleted content from raw data, derived exports, indexes, and caches. Roster or
retention expansion stays off until those conditions are reverified.

The initial operating assumption is Reddit's documented free-access limit of
100 queries per minute per OAuth client. Throughput is paced from Reddit's
rate-limit headers and remeasured during every rollout cohort. Current policy
references are the [Reddit Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki),
[Developer Terms](https://redditinc.com/policies/developer-terms), and
[Data API Terms](https://redditinc.com/policies/data-api-terms).

### Roster

The canonical machine-readable roster remains High Signal's
`reddit_communities.json`; Reddit Insights consumes a generated projection so
the collector and research UI cannot drift into two hand-maintained lists.
Each entry has a stable subreddit name, priority, state, added date, last
successful collection time, and optional pause reason. Case-insensitive
duplicates are invalid.

The launch roster is the following 99 public communities:

```text
Accounting, AI_Agents, androiddev, artificial, ChatGPT, ClaudeAI, cloud,
computervision, cscareerquestions, cybersecurity, dataengineering, datascience,
deeplearning, developersIndia, devops, ecommerce, Entrepreneur,
EntrepreneurRideAlong, EtsySellers, ExperiencedDevs, gamedev, india,
IndianStartups, IndiaTech, indiehackers, investing, MachineLearning, marketing,
midjourney, MLOps, OpenAI, ProductManagement, SaaS, sales, selfhosted, shopify,
singularity, smallbusiness, softwareengineering, StableDiffusion, startups,
stocks, technology, wallstreetbets, AMD_Stock, NVDA_Stock, semiconductors,
hardware, datacenter, nvidia, amd, intel, homelab, sysadmin, kubernetes, docker,
aws, googlecloud, AZURE, netsec, privacy, opensource, database, robotics,
renewableenergy, energy, supplychain, logistics, manufacturing, generativeAI,
LanguageTechnology, reinforcementlearning, PromptEngineering, ClaudeCode,
ollama, comfyui, LocalLLaMA, venturecapital, ycombinator, digital_marketing,
growthhacking, CustomerSuccess, remotework, layoffs, overemployed, economy,
Economics, StockMarket, SecurityAnalysis, ValueInvesting, algotrading,
CryptoCurrency, Bitcoin, ethereum, fintech, IndiaInvestments,
indianstockmarket, IndiaTax, IndianWorkplace
```

The original validation cohort is `LocalLLaMA`, `MachineLearning`,
`developersIndia`, `IndianStartups`, `IndiaInvestments`, `SaaS`, `startups`,
`technology`, `hardware`, and `StockMarket`. Any move beyond 99 is a new roster
decision. The approximately 1,000-community figure remains a capacity ceiling,
not a committed collection target.

### Daily collection depth

For each active community and UTC day, the canonical collector pages `/new`
backward through one exact half-open 24-hour window. It stores returned posts
once by stable ID. It traverses returned comment trees and `morechildren`, then
retains comments with score 2 or higher, submitter/moderator/sticky comments,
and the low-score ancestor chain needed to understand a retained reply.
Unrelated low-score branches are discarded.

Every listing cap, unresolved `morechildren` item, inaccessible community, and
failed request remains explicit in the manifest. Stable watermarks and IDs make
interrupted work resumable without repeating content. The collector follows
Reddit's reported rate budget and does not add client IDs to increase it.

### Storage and serving

There is one raw archive: High Signal's private R2 bucket. Reddit Insights does
not provision another bucket or D1 body/search index. The daily archive stores
five bounded objects under an immutable run, attempt, and UTC date prefix:

```text
posts.jsonl.zst
comments.jsonl.zst
events.jsonl.zst
subreddits.index.json
manifest.json
```

Post and comment rows are schema-normalized arrays, so field names are declared
once rather than repeated in every record. All communities share one posts
frame and one comments frame, allowing the codec to exploit repeated structure
across subreddits. The index records each community's decoded line and byte
ranges. The manifest records schema, codec parameters, counts, omissions,
checksums, and the exact source window.

Cold packs use Zstandard 22 with long-distance matching (`--long=27`) and no
trained dictionary. The existing 112-community benchmark reduced 268,077,889
bytes of normalized rows to 66,105,037 bytes. Zstandard 22 was smaller than
Zstandard 19, Brotli 11, and XZ/LZMA2 `-9e`, while decoding the result in 0.38
seconds. Compression runs asynchronously on the archive runner; the Cloudflare
Worker runtime only provides gzip/deflate streams, so the product does not add
a WASM Zstandard dependency to a request path.

The current 99-community production receipt is the planning baseline: 31,569
comments retained from 50,270 observed, 2,589 Reddit requests, zero retries,
and 5,381,724 compressed bytes for posts, retained comments, and consumer
events. At that rate, one year is approximately 1.96 GB before small manifests
and indexes.

`events.jsonl.zst` is the versioned consumer contract. Reddit Insights verifies
the pointer and SHA-256, decompresses the named object, and materializes only
the bounded display/report fields needed for the active analysis. Temporary
imports live under `artifacts/`, are never committed, and expire within seven
days. Public pages contain only their current compact display projection.

Historical subreddit/date/keyword requests run as bounded asynchronous exports
against the canonical packs. Results are streamed to the requester and expire
within 24 hours. The first release does not keep a second full-text search
database or 31-day hot copy merely to make those requests synchronous.

At 99 communities, the archive keeps one cross-community pack per record kind.
Before any larger cohort, benchmark deterministic 100-community shards against
the single-pack baseline. Adopt shards only when they reduce retry/redaction
blast radius with less than a 5% compression penalty. Never create one R2
object per post, comment, or community-day.

### Retention and source deletion

Canonical source content has a rolling 365-day limit, enforced by an R2
lifecycle rule. GitHub Actions artifacts and Reddit Insights imports expire
after seven days; one-off exports expire after 24 hours. No daily data is
committed to Git.

Use R2 Standard for the 365-day archive. It has no minimum storage duration,
retrieval fee, or charge for the first 10 GB-month each month. Infrequent Access
has no free tier, charges retrieval, and bills a 30-day minimum even when an
object is deleted early; the measured archive is too small for that trade to be
conservative. Reconsider the storage class only when measured retained data
exceeds 10 GB and historical reads are rare enough to lower total cost. Keep
the decision tied to Cloudflare's current [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
and [storage-class terms](https://developers.cloudflare.com/r2/buckets/storage-classes/).

Reddit or user deletion, protected-status, legal, and access-termination events
override the lifecycle. Affected raw rows, derived events, display data,
exports, and caches are removed or redacted within 48 hours, affected packs and
checksums are rebuilt, and the action is recorded by content-free tombstones.
The operator can pause all collection and exports immediately.

Archive version 3 stores no author names, user IDs, avatars, or profiles. Stable
post and comment IDs are retained only as required for idempotency, source
links, and deletion propagation. Version 2 author fields remain a migration and
redaction obligation until the minimized format replaces them.

### Reliability and observability

Every community-day has one terminal state: `complete`, `partial`, `empty`,
`unavailable`, or `failed`. Run manifests record requested and stored records,
listing and comment bounds, missing periods, duplicates, retries, rate-limit
waits, bytes, checksums, collector version, and failure class. Transient errors
retry with Reddit-directed backoff; permanent access failures pause the
community for operator review.

The operator view reports roster state, latest completed run, freshness,
missing-day rate, duplicate count, retained and discarded records, compressed
and decoded bytes, compression ratio and time, request use, estimated monthly
cost, and deletion backlog.

The 99-community storage budget is 10 MB compressed per day and 4 GB per rolling
year. Crossing either threshold for seven consecutive runs pauses roster
expansion and requires a field/retention review. No cohort advances on projected
cost alone; it needs a measured archive receipt and a stated research need.

## Functional requirements

1. The roster is validated, versioned, and usable by the collector and product
   navigation without maintaining a second list.
2. Collection is daily, bounded, idempotent, resumable, rate-limit aware, and
   honest about inaccessible or truncated data.
3. Stored posts and selected comments preserve source IDs, canonical links,
   text, publication and collection times, and available capture-time
   engagement metadata.
4. The private versioned read/export contract reproduces a requested slice and
   explains its coverage without another Reddit request.
5. Deletion propagates through every copy and derivative within the required
   window.
6. Historical views use retained observations, show collection start dates and
   missing periods, and do not promise unavailable backfill.
7. Community Intelligence moves from High Signal only after Reddit Insights
   matches the research, digest, consumer, and deletion behavior it needs. Raw
   archive ownership does not move with that product capability.

## Acceptance thresholds

The 99-community archive is accepted for Reddit Insights when all of the
following are demonstrated:

- 14 consecutive scheduled daily runs, with at least 98% of planned
  community-days reaching `complete` or `empty` and every remainder explicitly
  classified;
- an interrupted run publishes a new immutable attempt, reuses completed
  communities, and produces zero duplicate source IDs;
- a retained date range can be exported twice with matching object checksums and
  coverage metadata;
- a consumer retrieves posts and bounded comments by subreddit, date, and
  keyword without scraping Reddit;
- 95% of active communities are fresher than 26 hours after the scheduled
  window, and the missing-day rate stays below 2%;
- the operator can trace each gap, pause a community or the service, and observe
  retained/discarded records, compression, request use, and projected cost;
- daily compressed output remains at or below 10 MB and the rolling-year
  projection remains at or below 4 GB for seven consecutive qualification runs;
- Reddit Insights verifies the canonical pointer and object hash, renders a
  source-linked sample, and leaves no second raw archive behind;
- a deletion fixture removes or redacts the source record from raw storage,
  indexes, exports, and caches within 48 hours; and
- current Reddit authorization explicitly permits the use and retention model.

Any later cohort repeats these thresholds with a new measured storage budget.
The product reports 99-community coverage until an expanded roster itself
passes; the 1,000-community capacity ceiling is never presented as coverage.

## Rollout

1. **Protect the baseline:** keep High Signal's current archive as the only raw
   source and verify its current freshness, lifecycle, authorization, and pause
   controls.
2. **Remove roster drift:** generate Reddit Insights navigation and import scope
   from the canonical 99-community roster; do not copy the list into runtime
   code by hand.
3. **Minimize version 3:** remove author identifiers and any unused raw fields,
   keep schema-normalized rows, and rerun the codec benchmark before changing
   the format.
4. **Qualify retention:** observe 14 consecutive runs against the 10 MB/day and
   4 GB/year budgets and verify a real deletion propagation exercise.
5. **Finish the consumer path:** make bounded historical exports and derived
   research reports from the verified archive without persistent raw copies in
   Reddit Insights.
6. **Expand only for demonstrated need:** propose exact communities, measure a
   canary, benchmark packing/sharding, and set a new budget before adding any
   cohort beyond 99.
7. **Later product:** migrate Community Intelligence only after the research,
   digest, consumer, and deletion paths have proven parity.

## Boundaries

Reddit only. F5Bot, Google Trends, brand monitoring, response workflows, AI
visibility, news publishing, hosted end-user accounts, model training, and
general social-media ingestion belong elsewhere. Agent Data remains retired.
No historical backfill, full-thread promise, or completeness claim is part of
the initial release.
