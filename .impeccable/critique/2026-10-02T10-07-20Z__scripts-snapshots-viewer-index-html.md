---
target: Snapshot clean URLs, insights and scrolling
total_score: 36
max_score: 40
p0_count: 0
p1_count: 0
timestamp: 2026-10-02T10-07-20Z
slug: scripts-snapshots-viewer-index-html
---
Method: dual-agent (A: /root/polish_review_a; B: /root/polish_review_b)

Target: scripts/snapshots/viewer/index.html. Preserve the owner-delegated Calendar archive direction. Local qualification only; public release remains issue #21 task 8.

Design specificity: community/day navigation, exact UTC capture window, recorded engagement, retained-versus-reported discussion and source-linked observations form a coherent archive workspace. The new disclosure preserves the primary lookup/read/share task.

Nielsen /4: status 4; real-world match 4; control 4; consistency 4; error prevention 4; recognition 3; efficiency 3; minimalism 3; recovery 4; help 3. Total36/40. Independent A found no P0/P1, then reloaded the final control/heading/prose/mobile corrections and confirmed the result.

Strengths: clean date lookup plus exact-version sharing; observations link to captured discussions; qualified daily count comparison; native keyboard disclosure/dialog and focus return; append pagination preserves the reading position.
Cognitive load: two collection selectors, grouped share/download actions, optional insights. Expanded insights deliberately add reading depth rather than another dashboard. Alex can inspect and export evidence; Sam can use skip link, disclosure and dialog by keyboard; Casey gets actual available-date controls and 44px main actions.
Emotional journey: locate a day, verify the capture window, discover a notable discussion, inspect it, then share exactly the same evidence.

Resolved findings: essential input boundaries strengthened to3.57:1 against Studio; phone summary compacted to44px with first post visible; singular label copy corrected; H2 disclosure followed by H3 facts repairs the outline;70ch measure now uses13px prose font and measures506px on desktop. Show more retains existing DOM, reading position and new-row focus; dialog blocks background scrolling, contains overscroll, keeps Close visible and resets for each discussion.

Accepted P2: native99-community selector is long; tablet setup requires scrolling before posts; calendar targets28px with larger native date-control alternative; captured Markdown remains plain text. No existing safe Markdown renderer/dependency added.
No unresolved P0/P1.

Technical audit /4: accessibility3 (manual keyboard/contrast/semantics pass, full conformance not certified); performance4 (native modules, no model/network dependencies; previous collection fetched only when disclosure opens); responsive3 (320/390/768/1440 no horizontal overflow, small calendar cells); theming3 (role tokens with a few literals); implementation integrity4 (literal text rendering, data identity, expiry/revocation checks, meaningful route/metric tests). Total17/20. Independent A's narrower accessibility score19/20 is separate from this five-dimension audit.

Detector CLI exactly once: exit0,[] against markup. Linked CSS/generated DOM not covered by static scan. Browser overlay succeeded in fresh isolated [Human] tab with mutation proof; six palette occurrences, three expanded line-length occurrences, two font rules, one heading rule. Palette/font heuristics reflect intentional project-native Cyan/Arial. Heading and prose measure corrected after detector evidence. Closed-details text occlusion and detector-overlay self-occlusion were false positives. No parent detector rerun.
Overlay server8400 stopped by B; connection refused afterwards while product server7425 returned200. Product server predates critique and remains available for the owner's local preview.

Browser evidence:390/768/1440 screenshots plus320 sanity; native disclosure Enter/Space; Escape and focus restoration; sticky desktop navigation; 50→71 append with unchanged scrollY; long dialog independent scroll and sticky Close; new-dialog scrollTop0; Back/Forward; legacy query normalization; clean/pinned reload; expired/removed revision unavailable; complete-empty no invented insights; JSON and CSV attachment identity reconciled. Real Oct1 AI_Agents71posts350retainedcomments, median2, leader score60, reply leader81/11%, Sep30baseline96posts and26% fewer captured posts.

Checks:17 snapshot tests;54 repository unit tests;112 display artifacts;26 enrichment checks; format/lint/typecheck/node--check and final isolated Pages build plus7 asset checks pass. No new production dependencies, commits, push, deploy or production-config changes.
Run notes: slug scripts-snapshots-viewer-index-html; no ignore file; A/B isolated and A finished before parent detector synthesis; overlay mutation/injection confirmed; overlay-only server cleaned; generated build moved reversibly to Trash after qualification. Full deployment/R2/binding/refresh/redaction/cleanup/runtime gates remain open.
