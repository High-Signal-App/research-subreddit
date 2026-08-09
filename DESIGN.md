---
name: Reddit Insights
description: A living research studio for Reddit community evolution
colors:
  void: "#060913"
  studio: "#0b1120"
  panel: "#10192b"
  panelRaised: "#142039"
  ink: "#f6f7fb"
  quiet: "#a9b5ca"
  rule: "#263653"
  ruleStrong: "#3b4f73"
  cobalt: "#3677ff"
  ultraviolet: "#8b5cf6"
  cyan: "#23c6d7"
  lime: "#b7ea32"
  coral: "#ff6655"
typography:
  display:
    fontFamily: "Arial Black, Arial, Helvetica, sans-serif"
    fontSize: "clamp(2.8rem, 7vw, 6.4rem)"
    fontWeight: 900
    lineHeight: 0.92
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    letterSpacing: "0.04em"
  scale:
    analytical: "13px"
    small: "14px"
    control: "15px"
    body: "16px"
    lead: "18px"
    headings: "20px / 22px / 24px / 26px / 28px / 30px / 34px"
rounded:
  control: "10px"
  panel: "14px"
spacing:
  compact: "8px"
  standard: "16px"
  section: "72px"
---

# Design System: Reddit Insights

## Creative North Star

**The Top-Content Observatory.** Reddit Insights combines three modes without
turning them into separate products:

- **Research Studio** is the compact operating shell.
- **Canon Story** explains what the community historically rewarded and kept
  visible.
- **Candidate Observatory** shows what is earning attention in the inferred
  newest-post pool and how it differs from the canon.

The interface should feel like contemporary data journalism with the speed and
precision of professional research software. It explicitly rejects the former
archival newspaper/ledger aesthetic and the generic dashboard-card warehouse.

## Physical Scene

The operator uses this at a large monitor during a focused research session,
often in low ambient light. The canvas is dark because the visualizations own
large saturated fields, not because “analytics products are dark.”

## Palette

Void and Studio are the spatial canvas. Ink and Quiet establish reading order.
Cobalt, Ultraviolet, Cyan, Lime, and Coral are stable topic/data roles. Color is
allowed to occupy large chart regions; it is not sprinkled as decoration.
Glow is prohibited except for a subtle selected-data focus state.

## Typography

The system is sans-serif throughout. Display copy uses a heavy grotesk stance;
body, controls, evidence, and measurements use the workhorse stack. Headlines
are short, direct research conclusions rather than literary framing. Analytical
copy never drops below 13px on desktop or mobile.

## Composition

The first viewport is a working research contract, not a hero followed by a
report. It contains the community control, explicit Historical Canon and Recent
Candidate Pool definitions, three prioritized interpretations, and the evidence
density of the visible canon. Recent contenders and Now versus Canon form the
second act.
Evidence and methodology are attached to findings or progressively disclosed.

Desktop may use asymmetric 8/4 and 7/5 compositions. Mobile becomes a linear
story: finding, visualization, evidence. Dense SVGs may scroll locally with an
explicit cue; the document never scrolls horizontally.

## Components

### Command strip

A low-height top bar holds brand, an authored searchable community picker, the
fixed Top-content canon research lens, and research-section destinations. A
research-window selector is omitted because arbitrary date slicing cannot repair
the historical sampling mismatch.
Section links track the current research act as the operator moves through the
long document. Collection-only views omit Observatory navigation rather than
linking to an unavailable analysis layer.

### Canon timeline

The signature opening visualization shows evidence density and leading detected
topics across represented canon years. It never labels ranked-record counts as
total subreddit activity.

### Canon lead rail

Exactly three primary interpretations follow the sampling contract: a canon
anchor, a current shift, and an attention outlier. Each names the evidence lens,
sample count, and relative metric. They never become confidence claims or total-
conversation estimates.

### Recent contenders

The candidate list ranks mature recent posts within age bands using score and
reply-count percentiles. Every row links to Reddit and exposes age, topic, score,
reply metadata, and a relative candidate index. The index is explicitly not a
prediction of quality or final rank.

### Story chapter

Each chapter answers: what changed, why it matters, and what evidence supports
it. One large chart is preferred over several small cards.

### Now versus the canon

The synthesis compares topic representation in the inferred recent pool with
the ranked historical canon. It may classify durable winners, emerging
contenders, fading canon, saturation, and undersupplied attention, but always
labels the comparison as two sampling lenses rather than a census.

### Signal deck

Repeated phrases, emerging language, detected-topic share, flair/content-format
share, and platform-attention measures operate on the inferred recent candidate
pool only. Missing collection months are not imputed as zero. Unlike units such
as candidate count, median score, and approval remain independently scaled and
plainly labeled.

The signal deck is a post-only content-intelligence layer. It exposes repeated
phrases, emerging vocabulary, topic performance, boundary-aware language
markers, flair-label patterns, and score/upvote-ratio density one view at a
time. Contributor rankings are not part of the primary research path. Every
view names its coverage and metric limitations and uses progressive disclosure
rather than restoring an equal-card dashboard.

Collection-only communities use a Corpus Profile mode rather than an evolution
story. They may expose language, format, timing, attention, and sources, but do
not receive turning-point or activity-regime claims until topic/time enrichment
exists.

## Motion

One orchestrated moment: the topic river draws into place and annotations settle
when the report loads or the selected window changes. All information remains
visible without motion, and `prefers-reduced-motion` disables the sequence.

## Product Rules

- Lead with the sampling contract, three findings, and one canon visualization.
- Attach evidence to findings; do not make users bridge distant sections.
- Preserve all collected data through progressive disclosure, not simultaneous
  exposure.
- Exclude comments from the active interface for now. Keep comment ingestion and
  downstream readiness intact, but do not let incomplete comment coverage shape
  the research story.
- Do not expose cross-community comparison until normalized metrics exist.
- Do not use serif display type, archival rules, tiny badges, or equal card grids
  as the primary hierarchy.
- Do not fabricate causality, completeness, or topic relationships.
