# Reddit Insights status

Updated October 2, 2026. Tracking: [snapshot feature #21](https://github.com/High-Signal-App/research-subreddit/issues/21).

Snapshot Studio is committed, pushed and qualified for release. The owner
authorized the existing private R2 binding, automated collection/redaction
refresh and seven-day cleanup of obsolete derivative objects. Public deployment
acceptance is tracked in issue #21; the release target is
https://reddit-insights.highsignal.app/.

The local snapshot viewer supports subreddit/collection-date selection,
available-date navigation, recorded posts and retained discussion, search/sort,
revision-pinned share links and JSON/posts CSV/comments CSV downloads.
URLs now use `/r/<subreddit>/<date>/`, with a short version suffix for exact
shares. Legacy query links normalize to that path. The insights disclosure
summarizes captured engagement, post labels and comparable prior post counts;
partial or mismatched collections do not produce daily-change claims. Discussion
scrolling, focus return and appended-post reading positions are preserved.
Its verified importer produces bounded private gzip derivatives; the shared API
enforces 24-hour expiry, catalog revocation and checksum validation.

Local qualification uses 99 communities on each of September 30 and October 1.
October 1 r/AI_Agents reconciles to 71 posts and 350 retained comments;
September 30 reconciles to 96 posts and 468 retained comments. Dates refer to
collection windows, not exact UTC publishing-day censuses.

Archive R2 access is restored and authoritative September 30/October 1 packs
are reverified. The Pages Function passes Cloudflare runtime checks at the
existing compatibility date. The checked-in Pages configuration binds the
private derivative bucket; the serving adapter has no raw archive access.
Publication uploads minimized gzip objects before switching the verified
catalog. Daily collection and redaction refresh source manifests, renew 24-hour
leases and replace changed revisions. Obsolete derivatives expire after seven
days; active exports are retouched after five days. Raw archive storage stays
private and unchanged by publication.

Local raw research files and embeddings were moved reversibly to Trash. Compact
display data and existing reports were preserved; old research need not be rerun
to use the new daily snapshot path.

The owner approved Snapshot Studio (A) after comparing three complete directions.
The homepage and daily reader now use its pale-paper/navy/cobalt Archivo system.
The homepage offers unexpired community/date choices and live captured evidence;
preview titles open the chosen discussion in the pinned collection. Empty,
failed, expired and unavailable collections keep their distinct states.
The local homepage is at http://127.0.0.1:7425/.

Snapshot Studio qualification:20 snapshot tests,57 full unit tests,112 display artifacts,26 enrichment checks,7 Pages artifact checks and format/lint/typecheck passed. Independent review33/40, audit16/20, lowest viewport purpose89/100; no unresolved P0/P1. Direction evidence and final screenshots remain under gitignored artifacts/design/.
