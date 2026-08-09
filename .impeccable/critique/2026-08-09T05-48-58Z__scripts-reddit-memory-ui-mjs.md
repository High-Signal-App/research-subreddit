---
timestamp: 2026-08-09T05-48-58Z
slug: scripts-reddit-memory-ui-mjs
---
# UI critique v3

Target: `scripts/reddit-memory-ui.mjs`  
Live surface: `http://localhost:7431/?subreddit=LocalLLaMA&period=all`  
Method: two independent read-only assessments; design review completed without detector context, followed by isolated detector/browser evidence.

## Verdict

The surface is structurally cleaner and technically stable, but it still behaves more like a generated analyst report than a guided research product. The lead chart is 2,528 pixels below the top on desktop and arrives even later in the mobile reading journey. The operator must mentally combine eras, movers, turning points, charts, and sources instead of receiving two or three traceable findings first.

## Nielsen scores

1. Visibility of system status: 3/4
2. Match with the real world: 3/4
3. User control and freedom: 3/4
4. Consistency and standards: 2/4
5. Error prevention: 3/4
6. Recognition rather than recall: 2/4
7. Flexibility and efficiency: 2/4
8. Aesthetic and minimalist design: 2/4
9. Error recognition and recovery: 3/4
10. Help and documentation: 2/4

Total: 25/40 — acceptable, with a solid foundation and a major focus problem.

## Cognitive load

Four checklist failures: single focus, chunking, one thing at a time, and working-memory burden. Grouping, minimal visible control choices, progressive disclosure, and basic hierarchy pass. The archive is appropriately collapsed, but eight conceptual blocks still precede the conclusion. Aggregate findings and their evidence remain spatially separated.

## Priority findings

### P1

- The primary research answer is buried. Put a concise two-to-three-finding readout and the lead chart immediately after the title.
- Findings are not the unit of navigation. Each finding should connect claim, magnitude, time window, coverage/readiness, and representative post/comment evidence.
- Comment usefulness needs an explicit Strong / Partial / Sparse readiness verdict and a list of safe analyses for the selected community.
- Live analytical labels at 0.65–0.8rem are too small, particularly on mobile.

### P2

- Merge eras, movers, and turning points into one Evolution sequence rather than three separated interpretations.
- Demote the source-evidence preview; it repeats Top Posts and competes with the lead chart.
- Add a clear local-scroll cue to mobile charts.
- The native datalist is functional but weak for browsing and ranking 113 communities.
- Move the bottom readout upward; it is more valuable than much of the material above it.

## Comment-data assessment

Comments are valuable for disagreement, answer quality, objections, recommendations, expertise signals, vocabulary divergence, and reply-level sentiment. They should not yet be used for broad cross-community prevalence comparisons.

Across 113 communities: 193,886 stored comment bodies occur on 11,190 of 192,216 posts (5.8%). Stored bodies equal about 0.8% of the 24.3 million Reddit reply-count metadata total. Median community coverage is 2.8% of posts. LocalLLaMA (97.9%), Accounting (60.6%), ClaudeAI (45.0%), Berlin (42.1%), AI_Agents (39.6%), and Business_Ideas (27.0%) are the strongest candidates for comment analysis.

The available text is substantive in those stronger corpora: median body length is roughly 100–211 characters and 55–79% of comments exceed 80 characters. The main constraint is representativeness, not text quality.

## Detector and browser evidence

The detector ran exactly once and returned 85 findings: one Arial warning and 84 color/type/radius advisories. Many are legacy CSS overridden by the active Temporal Atlas layer; some live small-type and hard-coded chart-color drift remains.

At 390, 768, and 1440 pixels the document width matched the viewport, with no console errors, broken SVGs, or visible empty-chart states. Search, invalid-input validation, keyboard disclosure toggles, and the 113-row comment directory worked. Page heights were 6,594, 5,490, and 4,287 pixels respectively.

## Run notes

- Stable target resolved: `scripts/reddit-memory-ui.mjs`
- Ignore list: absent
- Assessments: isolated and independent
- CLI detector: completed once
- Browser visibility: headless Playwright evidence; no human overlay was started
- Overlay injection/live server/temp cleanup: not applicable
