---
timestamp: 2026-10-02T11-52-23Z
slug: scripts-snapshots-viewer-home-html
---
# Snapshot Studio final design review
Target: scripts/snapshots/viewer/home.html; related daily reader index.html.
Mode: Persuade homepage / Operate reader. Approved A Snapshot Studio. Independent read-only Assessment A and B; A finished before B findings entered synthesis.

## Verdict
Approved visual system implemented faithfully: pale paper, navy Archivo, cobalt date stage, real captured-data proof and native community/date lookup. The light reader continues the same system. Critique 33/40; technical audit 16/20; lowest viewport purpose score 89/100. No unresolved P0/P1.

## Heuristics
| Dimension | /4 |
|---|---:|
| System status | 3 |
| Real-world match | 4 |
| User control | 3 |
| Consistency | 4 |
| Error prevention | 4 |
| Recognition | 3 |
| Efficiency | 3 |
| Aesthetic / minimalist | 3 |
| Error recovery | 3 |
| Help / documentation | 3 |
| Total | 33/40 |

## Technical audit
Accessibility 3, performance 3, responsive 3, theming 3, implementation integrity 4: 16/20. Measured text contrast passes AA (B observed minimum home 4.63:1 and reader 5.11:1 before minor token consolidation); not an exhaustive certification. All main actions at least44px. Calendar secondary cells meet24px AA minimum but remain below44px guideline; a larger native date control is available. No dark mode claimed.

## Fresh visitor comprehension
Product: a viewer for captured subreddit/day snapshots.
Audience: people inspecting communities they follow, including shared snapshot recipients.
Value: see captured discussion and take the evidence/data with you.
Mechanism: select subreddit and collection date, open source-linked posts/discussion.
Proof: real dated AI_Agents capture with literal recorded engagement and captured/retained counts.
Next action: Open snapshot; no account; JSON/CSV sharing. Desktop exposes expiry/filtering in opening; phone exposes selected post count.
Scores desktop95/tablet93/phone89. Phone components: product24/25, audience13/15, value14/15, mechanism15/15, proof8/15, nextAction15/15.

## Material findings and fixes
All three A P2 issues resolved and independently rechecked: tablet word separator, preview titles now deep-link to matching discussion in a pinned collection, DESIGN explicitly supersedes the dark daily direction and records exact light tokens. Sharing now states expiry beside exports. Brand targets enlarged to44px and repeated palette roles consolidated.

Remaining P2: small secondary desktop/tablet calendar cells; larger native date entry supplies an alternative.
Remaining P3: phone proof stage follows lookup rather than appearing fully in first viewport, matching the approved comp; plain captured text retains raw Markdown; some line-length detector advisories.

## Design specificity and personas
The dated capture is proof specific to this product, rather than generic decoration. Operator lookup, recipient evidence inspection and researcher downloads stay legible. Three homepage decisions and four differentiated reader export actions keep cognitive load low; findings use progressive disclosure. No material unused device versus approved comp. Emotional journey moves from invitation to actual evidence to useful reading; the prior proof-link detour is fixed.

## Detector evidence
CLI ran once on viewer directory, exit2: one side-tab warning at style.css line5, neutral reply border. False positive: captured reply hierarchy, not colored card ornament.
Browser injections succeeded on home, Oct1 reader and Sep30 reader with dialog:21 reports (single-font3, line-length14, thin-border/wide-shadow2, text-occlusion1, first-viewport-column-overflow1). Approved Archivo, native modal, collapsed-details geometry and intentional sticky sidebar explain the false positives. Line lengths remain advisory. No second detector run.

## Runtime evidence
Real Oct1 AI_Agents71posts350retainedcomments; LocalLLaMA65/908; IndiaInvestments empty0/0. Generation test ignored delayed AI result after selecting LocalLLaMA. Simulated catalog503, all-expired catalog and removed-revision410 clear evidence, disable open and expose recovery. Actual pinned preview title opens 1wu2d7b discussion with30 retained comments/81reported replies. JSON and CSV return200 attachments. Native pointer open/Escape returns focus; dialog locks body, resets scroll and keeps Close reachable. Appended posts preserve scrollY5588 while50→71 and focus the first new post.
Home and reader no horizontal overflow390/768/1440; home also320. Metadata>=13px. No console errors. Build ships93 historical routes plus the data-free home/reader shells and self-hosted89.8KB Archivo with OFL.

## Run notes
Slug scripts-snapshots-viewer-home-html. No ignore file applicable. Independent A/B and fresh A finish follow-up. Browser mutable preflight/injection passed; B's detector serverPID24437 stopped through its stop endpoint and verified absent. Preview serverPID16208 stopped. Product server7425 stays running for requested local use. Comparison scaffolds/rejected HTML and isolated build output move reversibly to Trash; screenshot evidence remains. Questions skipped: owner already selected A and all material fixes were deterministic. No commit, push or deployment.

## Limits
Public site remains historical observatory. Before release: R2 restoration, source-checkout reconciliation, private export binding, authoritative refresh/removal, cleanup and Cloudflare runtime qualification. Canonical Site Health production purpose/source remain stale; user excludes production-config edits. Local work is fully reviewable without changing them.
