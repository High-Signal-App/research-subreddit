---
target: Subreddit/day snapshots and open exports
total_score: 33
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
timestamp: 2026-10-02T09-34-06Z
slug: scripts-snapshots-viewer-index-html
---
Method: dual-agent (A: /root/snapshot_design_review; B: /root/snapshot_browser_review)

Target: scripts/snapshots/viewer/index.html. Owner delegated Calendar archive. Operate surface. This is local feature qualification, not deployment.

| Heuristic | Score /4 |
|---|---:|
| Visibility of system status | 4 |
| Match with real world | 4 |
| User control and freedom | 4 |
| Consistency and standards | 3 |
| Error prevention | 3 |
| Recognition over recall | 3 |
| Flexibility and efficiency | 3 |
| Aesthetic and minimalist design | 3 |
| Error recovery | 3 |
| Help and documentation | 3 |
| Total | 33/40 |

Design specificity: coherent and grounded in community/collection-date lookup. Exact UTC window, stable source identity, retained-versus-reported discussion counts, explicit missing states and reconciled downloads distinguish this product. Native dark Studio/Arial system preserved.

Independent A initially scored 28/40; after availability, typography, mobile hierarchy and recovery corrections, 31/40; final Back/Forward, loading-announcement and metric-column verification scored33/40. These intermediate assessments were not persisted as separate trend runs.

Strengths: source-grounded counts and scope, visible sharing/export actions, native accessible dialog with Escape and focus return, responsive available-date navigation.

Cognitive load: two primary selectors; four grouped sharing/download actions. Calendar disables unavailable dates. Mobile lists actual collection dates. A native99-community menu remains progressively disclosed and slower for repeat exploration.

Emotional journey: clear selection and source contract, immediate capture/count confirmation, readable captured thread, direct share/download endpoint. Missing dates retain selection and provide latest-available recovery.

Resolved P1: unavailable calendar dates invited failure; mobile hid availability; 10-12px analytical text violated repository minimum. Available days only now interactive, mobile date menu explicit, functional labels >=13px.

Resolved smaller issues: completeness qualification now beside counts; sticky thread-close header; mobile first post moved from1078px to721.8px; searchcount live region; calendarfocus restoration; browserBack/Forward; explanatory paragraphs narrowed70ch.

Accepted P2: captured text remains plain text, including rawMarkdown; large native communitymenu; shareURLs identify collections rather than individual open discussions. No existing safeMarkdown renderer or extra production dependency introduced. P2 audit: tablet/desktop calendar cells below44px recommendation but >=24px and larger native date control alternative; some status colors remain CSS literals.

Persona checks: Alex can retrace collections throughBack/Forward and download whole snapshot; Sam has visible keyboardfocus, native dialog Escape/focusreturn and loading/search announcements; Casey has real available-date choices,44px maincontrols and firstpost within390x844 initialviewport. Unknown/missingdate and completed-empty captures were tested.

Technical audit:
| Dimension | Score /4 |
|---|---:|
| Accessibility | 3 |
| Performance | 4 |
| Responsive design | 3 |
| Theming | 3 |
| Implementation integrity | 4 |
| Total | 17/20 |

CLI detector exactly once: exit0,[]; zero findingrules/locations.
Browseroverlay inspected three views: populated11,missing8,completed-empty11 advisory findings. Rules: ai-color-palette (cyan on dark), overused-font/single-font (Arial), line-length. Cyan and Arial are intentional project-native highcontrast choices; line-length addressed by70ch measure. No blanketstyle changes to silence detector. Overlay server stopped and health check confirmed unavailable; DOM-only injection, no source tags.

Checks: source tests verify checksum/schema/line-byte partition/count/window constraints, field minimization/redaction, CSVformulaescaping, pinned exportidentity, missing/removed/expired/unavailable behavior and boundedreads. Both downloaded dailybatches verified99communities. AI_Agents Oct1:71posts350comments; Sep30:96posts468comments. Browser390/768/1440 nooverflow, plus320 sanitycheck.

Snapshots after390/768/1440 under artifacts/design/snapshots/. Public deployment and Cloudflare runtime/binding qualification remain issue21 releasegates. Local viewer runs on127.0.0.1:7425.
