/**
 * THESIS: A living research studio turns Reddit history into three findings,
 * then lets the operator explore the underlying topic-time record.
 * OWN-WORLD: Dark spatial canvas, heavy sans type, saturated topic fields,
 * generous chapters, and one visualization-led focal point at a time.
 * STORY: Orient with the topic river, understand through evidence-backed
 * chapters, then play inside the Community Observatory and source lab.
 * FIRST VIEWPORT: Compact command strip above a dominant temporal topic river
 * with a three-finding rail; no report hero, sidebar, comparison, or comments.
 * FORM: Research Studio + Data Story + Community Observatory; delegated blend
 * of the topic-river and story-matrix probes, with radial exploration optional.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { gunzipSync } from "node:zlib";
import { renderResearchStudio } from "./reddit-research-studio.mjs";

const DEFAULT_SUBREDDIT = process.argv[2] || "LocalLLaMA";
const PORT = parseInt(process.env.PORT || "7424", 10);
const DATA_DIR = process.env.REDDIT_DATA_DIR || join(process.cwd(), "data", "reddit-memory");
const DISPLAY_DIR = process.env.REDDIT_DISPLAY_DIR || join(process.cwd(), "data", "reddit-display");
const CORPUS_CACHE = new Map();

const PERIODS = [
  { key: "all", label: "All time", days: null },
  { key: "365d", label: "Last year", days: 365 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "7d", label: "Last 7 days", days: 7 },
];

function loadReport(subreddit, days) {
  const suffix = days ? `-${days}d` : "";
  const file = join(DATA_DIR, `${subreddit}-report${suffix}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

function availableSubreddits() {
  const names = new Set();
  if (existsSync(DATA_DIR)) readdirSync(DATA_DIR).forEach(file => {
    const name = file.match(/^(.+)\.json$/)?.[1];
    if (name && !/-report(?:-|$)|-anchors$|-high-signal$/.test(name)) names.add(name);
  });
  if (existsSync(DISPLAY_DIR)) readdirSync(DISPLAY_DIR).forEach(file => {
    const name = file.match(/^(.+)\.json(?:\.gz)?$/)?.[1];
    if (name && name !== "index") names.add(name);
  });
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function loadCorpus(subreddit) {
  if (CORPUS_CACHE.has(subreddit)) return CORPUS_CACHE.get(subreddit);
  const compressedFile = join(DISPLAY_DIR, `${subreddit}.json.gz`);
  const compactFile = join(DISPLAY_DIR, `${subreddit}.json`);
  const rawFile = join(DATA_DIR, `${subreddit}.json`);
  const file = existsSync(compressedFile) ? compressedFile : existsSync(compactFile) ? compactFile : rawFile;
  if (!existsSync(file)) return { posts: [], coverage: null };
  const payload = JSON.parse(file.endsWith(".gz") ? gunzipSync(readFileSync(file)).toString("utf8") : readFileSync(file, "utf8"));
  const corpus = { posts: Array.isArray(payload) ? payload : (payload.posts || []), coverage: payload.coverage || null };
  CORPUS_CACHE.set(subreddit, corpus);
  return corpus;
}

function loadRawPosts(subreddit) {
  return loadCorpus(subreddit).posts;
}

function startOfWeek(date) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() - copy.getUTCDay());
  copy.setUTCHours(0, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
}

function buildCollectionReport(subreddit, days) {
  const corpus = loadCorpus(subreddit);
  const allPosts = corpus.posts.filter(post => Number.isFinite(Number(post.created_utc)));
  if (!allPosts.length) return null;
  const latestEpoch = Math.max(...allPosts.map(post => Number(post.created_utc)));
  const cutoff = days ? latestEpoch - days * 86400 : -Infinity;
  const posts = allPosts.filter(post => Number(post.created_utc) >= cutoff);
  if (!posts.length) return null;
  const byDate = [...posts].sort((a, b) => Number(a.created_utc) - Number(b.created_utc));
  const dateFor = post => new Date(Number(post.created_utc) * 1000);
  const dayKey = post => dateFor(post).toISOString().slice(0, 10);
  const monthKey = post => dayKey(post).slice(0, 7);
  const commentCount = post => Number(post.num_comments || 0);
  const score = post => Number(post.score || 0);
  const topPosts = [...posts].sort((a, b) => score(b) - score(a)).slice(0, 20).map(post => ({
    title: post.title || "Untitled post", score: score(post), comments: commentCount(post), upvoteRatio: Number(post.upvote_ratio || 0), flair: post.link_flair_text || "", author: post.author || "", date: dayKey(post), permalink: post.permalink || null
  }));
  const mostCommented = [...posts].sort((a, b) => commentCount(b) - commentCount(a)).slice(0, 20).map(post => ({
    title: post.title || "Untitled post", score: score(post), comments: commentCount(post), upvoteRatio: Number(post.upvote_ratio || 0), flair: post.link_flair_text || "", author: post.author || "", date: dayKey(post), permalink: post.permalink || null
  }));
  const monthCounts = new Map();
  const yearCounts = new Map();
  const weekCounts = new Map();
  const dayCounts = new Map();
  const authorCounts = new Map();
  const authorScores = new Map();
  const authorReplies = new Map();
  const activityGrid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const post of posts) {
    const date = dateFor(post);
    monthCounts.set(monthKey(post), (monthCounts.get(monthKey(post)) || 0) + 1);
    yearCounts.set(String(date.getUTCFullYear()), (yearCounts.get(String(date.getUTCFullYear())) || 0) + 1);
    const week = startOfWeek(date);
    const weekValue = weekCounts.get(week) || { posts: 0, comments: 0, score: 0 };
    weekValue.posts += 1; weekValue.comments += commentCount(post); weekValue.score += score(post); weekCounts.set(week, weekValue);
    const day = dayKey(post);
    const dayValue = dayCounts.get(day) || { posts: 0, comments: 0, score: 0 };
    dayValue.posts += 1; dayValue.comments += commentCount(post); dayValue.score += score(post); dayCounts.set(day, dayValue);
    const author = post.author || "[deleted]";
    authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
    authorScores.set(author, (authorScores.get(author) || 0) + score(post));
    authorReplies.set(author, (authorReplies.get(author) || 0) + commentCount(post));
    activityGrid[date.getUTCDay()][date.getUTCHours()] += 1;
  }
  const months = [...monthCounts.keys()].sort();
  const weeklyData = [...weekCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, posts: value.posts, comments: value.comments, avgScore: Math.round(value.score / value.posts) }));
  const dailyData = [...dayCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([date, value]) => ({ date, dayName: new Date(`${date}T00:00:00Z`).toLocaleDateString("en", { weekday: "short", timeZone: "UTC" }), posts: value.posts, comments: value.comments, avgScore: Math.round(value.score / value.posts), posPct: 0, negPct: 0 }));
  const scores = posts.map(score).sort((a, b) => a - b);
  const replyPosts = posts.filter(post => commentCount(post) > 0).length;
  const scoreHistogram = [
    { range: "0", lo: 0, hi: 1, count: 0 },
    { range: "1-9", lo: 1, hi: 10, count: 0 },
    { range: "10-49", lo: 10, hi: 50, count: 0 },
    { range: "50-99", lo: 50, hi: 100, count: 0 },
    { range: "100-499", lo: 100, hi: 500, count: 0 },
    { range: "500-999", lo: 500, hi: 1000, count: 0 },
    { range: "1k-2k", lo: 1000, hi: 2000, count: 0 },
    { range: "2k-5k", lo: 2000, hi: 5000, count: 0 },
    { range: "5k+", lo: 5000, hi: Infinity, count: 0 },
  ];
  for (const value of scores) {
    const bucket = scoreHistogram.find(item => value >= item.lo && value < item.hi);
    if (bucket) bucket.count++;
  }

  // Comment karma distribution from stored comment bodies
  const commentKarmaBuckets = [
    { range: "0-4", min: 0, max: 4, count: 0 },
    { range: "5-9", min: 5, max: 9, count: 0 },
    { range: "10-19", min: 10, max: 19, count: 0 },
    { range: "20-49", min: 20, max: 49, count: 0 },
    { range: "50-99", min: 50, max: 99, count: 0 },
    { range: "100-199", min: 100, max: 199, count: 0 },
    { range: "200-499", min: 200, max: 499, count: 0 },
    { range: "500-999", min: 500, max: 999, count: 0 },
    { range: "1000+", min: 1000, max: Infinity, count: 0 },
  ];
  let storedCommentCount = 0;
  let postsWithStoredComments = 0;
  for (const post of posts) {
    const cmts = post.comments;
    if (cmts && cmts.length > 0) postsWithStoredComments++;
    for (const c of (cmts || [])) {
      storedCommentCount++;
      const k = Number(c.score ?? 0);
      for (const b of commentKarmaBuckets) {
        if (k >= b.min && k <= b.max) { b.count++; break; }
      }
    }
  }

  return {
    subreddit, generatedAt: new Date().toISOString(), collectionOnly: true, coverage: corpus.coverage,
    totals: { posts: posts.length, comments: posts.reduce((sum, post) => sum + commentCount(post), 0), texts: posts.length, dateRange: { start: dayKey(byDate[0]), end: dayKey(byDate.at(-1)) } },
    health: { totalPosts: posts.length, postsWithComments: replyPosts, totalComments: posts.reduce((sum, post) => sum + commentCount(post), 0), avgCommentsPerPost: posts.reduce((sum, post) => sum + commentCount(post), 0) / posts.length, answerRate: replyPosts / posts.length * 100, medianScore: scores[Math.floor(scores.length / 2)] || 0, topAuthors: [...authorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10) },
    evolution: { totalMonths: months.length, analyzedMonths: months.length, phases: [...yearCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, totalPosts]) => ({ period: year, dominantTopic: "Collected activity", dominantPct: 100, monthCount: months.filter(month => month.startsWith(year)).length, totalPosts })), topicEmergence: [], keyShifts: [], collectionOnly: true },
    periodComparisons: [], weeklyData, dailyData, topicBreakdown: null, topicBreakdownForChart: null, toneTrajectory: null, toneTrajectoryForChart: null, activityGrid,
    engagementScatter: posts.map(post => ({ id: post.id || "", permalink: post.permalink || "", title: post.title || "Untitled post", text: `${post.title || ""} ${post.selftext || ""}`.trim().slice(0, 2000), score: score(post), comments: commentCount(post), upvoteRatio: Number(post.upvote_ratio || 0), topic: post.topic || "Unclassified", flair: post.link_flair_text || "", created: Number(post.created_utc), date: dayKey(post) })), moderation: null, scoreHistogram,
    commentKarma: { buckets: commentKarmaBuckets, totalStored: storedCommentCount, postsWithStoredComments },
    commentCorpus: { available: storedCommentCount > 0, totalStored: storedCommentCount, postsWithStoredComments },
    topContributors: [...authorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([author, postCount]) => ({ author, posts: postCount, avgScore: Math.round((authorScores.get(author) || 0) / postCount), totalScore: authorScores.get(author) || 0, totalComments: authorReplies.get(author) || 0 })),
    topPosts, mostCommented, recurringQuestions: [], questionGroups: [], topics: [], tone: { posts: { total: posts.length, pos: 0, neu: posts.length, neg: 0, emotions: {} }, comments: { total: 0, pos: 0, neu: 0, neg: 0, emotions: {} } }
  };
}

function loadReports(subreddit) {
  const reports = {};
  for (const p of PERIODS) {
    const enrichedReport = loadReport(subreddit, p.days);
    const collectionReport = buildCollectionReport(subreddit, p.days);
    const r = enrichedReport ? {
      ...enrichedReport,
      coverage: collectionReport?.coverage || enrichedReport.coverage,
      commentKarma: collectionReport?.commentKarma || enrichedReport.commentKarma,
      commentCorpus: collectionReport?.commentCorpus || enrichedReport.commentCorpus,
    } : collectionReport;
    if (!r) {
      reports[p.key] = null;
      continue;
    }
    // Pick the right granularity for time-series charts based on period length
    // <=7 days: daily buckets; <=90 days: weekly buckets; longer: monthly buckets
    const days = p.days || 9999;
    if (days <= 7) {
      r.topicBreakdownForChart = r.topicBreakdownDaily || r.topicBreakdown;
      r.toneTrajectoryForChart = r.toneTrajectoryDaily || r.toneTrajectory;
    } else if (days <= 90) {
      r.topicBreakdownForChart = r.topicBreakdownWeekly || r.topicBreakdown;
      r.toneTrajectoryForChart = r.toneTrajectoryWeekly || r.toneTrajectory;
    } else {
      r.topicBreakdownForChart = r.topicBreakdown;
      r.toneTrajectoryForChart = r.toneTrajectory;
    }
    reports[p.key] = r;
  }
  return reports;
}

const communities = availableSubreddits();

function buildCommentCoverageIndex(communityNames) {
  return communityNames.map(community => {
    const posts = loadRawPosts(community);
    let storedComments = 0;
    let postsWithStoredComments = 0;
    let replyCountMetadata = 0;
    for (const post of posts) {
      const comments = Array.isArray(post.comments) ? post.comments : [];
      storedComments += comments.length;
      if (comments.length) postsWithStoredComments++;
      replyCountMetadata += Number(post.num_comments || 0);
    }
    return {
      community,
      posts: posts.length,
      storedComments,
      postsWithStoredComments,
      replyCountMetadata,
      postCoveragePct: posts.length ? postsWithStoredComments / posts.length * 100 : 0,
      capturePct: replyCountMetadata ? storedComments / replyCountMetadata * 100 : 0,
    };
  }).sort((a, b) => b.storedComments - a.storedComments);
}

const commentCoverageIndex = buildCommentCoverageIndex(communities);
const commentCoverageTotals = commentCoverageIndex.reduce((total, row) => ({
  posts: total.posts + row.posts,
  storedComments: total.storedComments + row.storedComments,
  postsWithStoredComments: total.postsWithStoredComments + row.postsWithStoredComments,
  replyCountMetadata: total.replyCountMetadata + row.replyCountMetadata,
}), { posts: 0, storedComments: 0, postsWithStoredComments: 0, replyCountMetadata: 0 });
const initialSubreddit = communities.includes(DEFAULT_SUBREDDIT) ? DEFAULT_SUBREDDIT : communities[0];
if (!initialSubreddit) {
  console.error(`No report found. Run analyze first.`);
  process.exit(1);
}
const initialReports = loadReports(initialSubreddit);

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (n, t) => t > 0 ? ((n / t) * 100).toFixed(2) + "%" : "0.00%";
const fmtNum = (n) => n == null ? "—" : n.toLocaleString();
const fmtCompact = (n) => {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "k";
  return n.toLocaleString();
};

const TOPIC_COLORS = ["#22d3ee","#a78bfa","#f59e0b","#4ade80","#f87171","#60a5fa","#fb923c","#e879f9","#34d399","#facc15","#c084fc","#94a3b8"];

// ─── Chart helpers ────────────────────────────────────────────────────────

function chartWidth(nMonths) { return Math.max(720, nMonths * 42); }
function labelStride(nMonths, chartW) {
  const minLabelSpace = 55;
  return Math.max(1, Math.ceil(nMonths * minLabelSpace / chartW));
}

// Tooltip helper for SVG elements
function tooltip(text) {
  return `aria-label="${esc(text)}"`;
}


// ─── 1. Topic Streamgraph (stacked area, proportions over time) ───────────

function renderTopicStreamgraph(breakdown) {
  if (!breakdown || breakdown.buckets.length < 1) return "<p class='sub'>Not enough data.</p>";
  let { labels, topics, matrix } = breakdown;
  let bucketTotals = matrix.map(row => row.reduce((a, b) => a + b, 0));

  // For long-term views, filter out under-sampled buckets so the streamgraph isn't flat/degenerate.
  // Short-term bar views keep everything because each bucket already has few data points.
  const isLongView = labels.length > 30;
  const minPosts = isLongView ? 20 : 5;
  const reliableIdx = bucketTotals.map((t, i) => t >= minPosts ? i : -1).filter(i => i !== -1);
  if (reliableIdx.length >= 2) {
    labels = reliableIdx.map(i => labels[i]);
    matrix = reliableIdx.map(i => matrix[i]);
    bucketTotals = reliableIdx.map(i => bucketTotals[i]);
  }
  const skipped = breakdown.buckets.length - labels.length;

  // Sort topics by total volume (most posts first)
  const topicTotals = topics.map((_, ti) => matrix.reduce((s, row) => s + row[ti], 0));
  const sortedIdx = topicTotals.map((_, i) => i).sort((a, b) => topicTotals[b] - topicTotals[a]);
  const sortedTopics = sortedIdx.map(i => topics[i]);
  const sortedMatrix = matrix.map(row => sortedIdx.map(i => row[i]));

  // Short periods (≤30 buckets) render as grouped/stacked bars; longer as streamgraph
  const useBars = labels.length <= 30;

  const W = useBars ? Math.max(700, labels.length * 60) : chartWidth(labels.length);
  const H = 340, padL = useBars ? 40 : 10, padR = 10, padT = 20, padB = 60;
  const chartW = W - padL - padR, chartH = H - padT - padB;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Topic volume by time period" style="width:${W}px;overflow:visible">`;

  if (useBars) {
    // Stacked bars showing absolute counts per bucket
    const maxTotal = Math.max(...bucketTotals, 1);
    const barW = Math.min(40, (chartW / labels.length) * 0.7);
    const stride = labelStride(labels.length, chartW);

    // Gridlines
    for (const f of [0, 0.25, 0.5, 0.75, 1.0]) {
      const v = Math.round(maxTotal * f);
      const y = padT + chartH - f * chartH;
      svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#1a1a1a" stroke-width="1"/>`;
      svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="#525252" font-size="10">${v}</text>`;
    }

    for (let mi = 0; mi < labels.length; mi++) {
      const x = padL + (mi + 0.5) * (chartW / labels.length);
      let y = padT + chartH;
      for (let ti = 0; ti < sortedTopics.length; ti++) {
        const h = (sortedMatrix[mi][ti] / maxTotal) * chartH;
        y -= h;
        svg += `<rect x="${x - barW / 2}" y="${y}" width="${barW}" height="${h}" fill="${TOPIC_COLORS[ti % TOPIC_COLORS.length]}" opacity="0.85" rx="2" ${tooltip(`${sortedTopics[ti]}: ${sortedMatrix[mi][ti]} posts in ${labels[mi]}`)}/>`;
      }
      if (mi % stride === 0 || mi === labels.length - 1) {
        svg += `<text x="${x}" y="${H - padB + 8}" text-anchor="end" fill="#a3a3a3" font-size="10" font-weight="500" transform="rotate(-35 ${x} ${H - padB + 8})">${labels[mi]}</text>`;
      }
    }
  } else {
    // Streamgraph for longer periods
    const xStep = labels.length > 1 ? chartW / (labels.length - 1) : 0;
    const stride = labelStride(labels.length, chartW);

    const stacked = sortedMatrix.map(row => {
      const total = row.reduce((a, b) => a + b, 0) || 1;
      return row.map(v => v / total);
    });

    const baseline = stacked.map(() => new Array(sortedTopics.length).fill(0));
    for (let mi = 0; mi < stacked.length; mi++) {
      let lower = -stacked[mi][0] / 2;
      for (let ti = 0; ti < sortedTopics.length; ti++) {
        baseline[mi][ti] = lower;
        lower += stacked[mi][ti];
      }
    }
    const yScale = chartH;
    const yCenter = padT + chartH / 2;

    for (let ti = 0; ti < sortedTopics.length; ti++) {
      const color = TOPIC_COLORS[ti % TOPIC_COLORS.length];
      let topPath = "";
      for (let mi = 0; mi < labels.length; mi++) {
        const x = padL + mi * xStep;
        const yTop = yCenter - (baseline[mi][ti] + stacked[mi][ti]) * yScale;
        topPath += (mi === 0 ? "M" : "L") + x + " " + yTop + " ";
      }
      let areaPath = topPath;
      for (let mi = labels.length - 1; mi >= 0; mi--) {
        const x = padL + mi * xStep;
        const yBot = yCenter - baseline[mi][ti] * yScale;
        areaPath += "L" + x + " " + yBot + " ";
      }
      areaPath += "Z";
      svg += `<path d="${areaPath}" fill="${color}" opacity="0.75" ${tooltip(sortedTopics[ti])}/>`;
    }

    svg += `<line x1="${padL}" y1="${yCenter}" x2="${W - padR}" y2="${yCenter}" stroke="#1a1a1a" stroke-width="1" stroke-dasharray="4 4"/>`;

    const minPostsForReliable = 20;
    for (let i = 0; i < labels.length; i++) {
      if (i % stride !== 0 && i !== labels.length - 1) continue;
      const x = padL + i * xStep;
      const isLow = bucketTotals[i] < minPostsForReliable;
      svg += `<text x="${x}" y="${H - padB + 8}" text-anchor="end" fill="${isLow ? '#fbbf24' : '#a3a3a3'}" font-size="10" font-weight="500" transform="rotate(-35 ${x} ${H - padB + 8})">${labels[i]}</text>`;
    }
  }

  svg += "</svg>";

  const legend = `<div class="chart-legend">${sortedTopics.map((t, i) =>
    `<div class="legend-item"><div class="legend-dot" style="background:${TOPIC_COLORS[i % TOPIC_COLORS.length]}"></div>${esc(t)} (${topicTotals[sortedIdx[i]]})</div>`
  ).join("")}</div>`;

  const title = "Which topics occupied the conversation?";
  const sub = useBars
    ? `Topic post counts per ${labels.length <= 7 ? 'day' : 'bucket'}. Hover bars for exact counts.`
    : "How topic proportions shift over time (centered baseline, sorted by total volume)";
  const coverageNote = useBars
    ? (skipped > 0 ? `<div class="coverage-note">Skipped ${skipped} low-activity buckets (< ${minPosts} posts).</div>` : "")
    : `<div class="coverage-note">Centered streamgraph (ThemeRiver). Each layer's thickness = topic share.${skipped > 0 ? ` Skipped ${skipped} low-activity buckets (< ${minPosts} posts).` : ""}</div>`;

  return `<div class="chart-card"><div class="chart-card-title">${title}</div><div class="chart-card-sub">${sub}</div>${coverageNote}<div class="chart-scroll time-series-scroll">${svg}</div>${legend}</div>`;
}

// ─── 2. Activity Heatmap (day-of-week × hour-of-day) ──────────────────────

function renderActivityHeatmap(grid) {
  if (!grid) return "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const maxVal = Math.max(...grid.flat(), 1);
  const cellW = 28, cellH = 24;
  const padL = 40, padT = 25, padR = 10, padB = 10;
  const W = padL + 24 * cellW + padR;
  const H = padT + 7 * cellH + padB;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Posting activity by weekday and hour in UTC" style="width:${W}px;max-width:100%;overflow:visible">`;

  // Hour labels
  for (let h = 0; h < 24; h++) {
    if (h % 3 !== 0) continue;
    const x = padL + h * cellW + cellW / 2;
    svg += `<text x="${x}" y="${padT - 8}" text-anchor="middle" fill="#737373" font-size="9">${h}h</text>`;
  }

  // Day labels + cells
  for (let d = 0; d < 7; d++) {
    const y = padT + d * cellH;
    svg += `<text x="${padL - 5}" y="${y + cellH / 2 + 4}" text-anchor="end" fill="#a3a3a3" font-size="10">${days[d]}</text>`;
    for (let h = 0; h < 24; h++) {
      const val = grid[d][h];
      const x = padL + h * cellW;
      const intensity = val / maxVal;
      const opacity = val === 0 ? 0.03 : 0.1 + intensity * 0.9;
      svg += `<rect x="${x}" y="${y}" width="${cellW - 1}" height="${cellH - 1}" rx="2" fill="#22d3ee" opacity="${opacity}" ${tooltip(`${days[d]} ${h}:00 — ${val} posts`)}/>`;
      if (val > 0 && intensity > 0.3) {
        svg += `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 3}" text-anchor="middle" fill="#000" font-size="8" font-weight="600">${val}</text>`;
      }
    }
  }

  svg += "</svg>";
  return `<div class="chart-card"><div class="chart-card-title">When does the community post?</div><div class="chart-card-sub">Posting activity by weekday and UTC hour. Brighter cells represent more collected posts; counts appear in the busiest cells.</div><div class="chart-scroll">${svg}</div></div>`;
}

// ─── 3. Top Posts Leaderboard ─────────────────────────────────────────────

function renderTopPosts(posts, title, sortBy) {
  if (!posts || posts.length === 0) return "";
  let table = `<div class="table-scroll-note">Scroll horizontally for full evidence →</div><div class="chart-scroll"><table class="data-table leader-table"><thead><tr>
    <th>#</th><th>Title</th><th>Score</th><th>Reply count</th><th>Upvote%</th><th>Flair</th><th>Author</th><th>Date</th>
  </tr></thead><tbody>`;
  posts.forEach((p, i) => {
    table += `<tr>
      <td>${i + 1}</td>
      <td class="post-title-cell">${canonicalRedditUrl(p.permalink) ? `<a href="${esc(canonicalRedditUrl(p.permalink))}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a>` : esc(p.title)}</td>
      <td><strong>${p.score}</strong></td>
      <td>${p.comments}</td>
      <td>${(p.upvoteRatio * 100).toFixed(0)}%</td>
      <td>${esc(p.flair)}</td>
      <td>${esc(p.author)}</td>
      <td style="color:var(--dim)">${p.date}</td>
    </tr>`;
  });
  table += `</tbody></table></div>`;
  return `<div class="chart-card"><div class="chart-card-title">${title}</div><div class="chart-card-sub">Sorted by ${sortBy}</div>${table}</div>`;
}

// ─── 4. Top Contributors Bar Chart ────────────────────────────────────────

function renderTopContributors(contributors) {
  if (!contributors || contributors.length === 0) return "";
  const maxPosts = Math.max(...contributors.map(c => c.posts), 1);
  const W = 500, barH = 22, gap = 4;
  const padL = 130, padR = 60, padT = 10, padB = 10;
  const H = padT + contributors.length * (barH + gap) + padB;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Top contributor post counts" style="width:100%;max-width:${W}px;height:auto">`;

  contributors.forEach((c, i) => {
    const y = padT + i * (barH + gap);
    const w = (c.posts / maxPosts) * (W - padL - padR);
    svg += `<text x="${padL - 8}" y="${y + barH / 2 + 4}" text-anchor="end" fill="#e5e5e5" font-size="11" font-weight="500">${esc(c.author)}</text>`;
    svg += `<rect x="${padL}" y="${y}" width="${w}" height="${barH}" rx="3" fill="#22d3ee" opacity="0.7" ${tooltip(`${c.author}: ${c.posts} posts, avg score ${c.avgScore}, ${c.totalComments} total comments`)}/>`;
    svg += `<text x="${padL + w + 5}" y="${y + barH / 2 + 4}" fill="#737373" font-size="10">${c.posts} posts · avg ${c.avgScore}</text>`;
  });

  svg += "</svg>";
  return `<div class="chart-card"><div class="chart-card-title">Who repeatedly shaped the record?</div><div class="chart-card-sub">The most active authors, with posting frequency and average score shown directly.</div><div class="chart-scroll">${svg}</div></div>`;
}

// ─── 5. Tone Trajectory (area chart with gradient) ────────────────────────

function renderToneChart(trajectory) {
  if (!trajectory || trajectory.length < 1) return "";
  const MIN_POSTS = 1;
  const filtered = trajectory.filter(t => t.postCount >= MIN_POSTS);
  if (filtered.length < 2) return "";
  const coverageNote = filtered.length < trajectory.length
    ? `<div class="coverage-note">Showing ${filtered.length} of ${trajectory.length} buckets (${MIN_POSTS}+ posts only)</div>`
    : "";

  const labels = filtered.map(t => t.label);
  const useBars = labels.length <= 30;

  const W = useBars ? Math.max(700, labels.length * 50) : chartWidth(labels.length);
  const H = 260, padL = 45, padR = 20, padT = 20, padB = 70;
  const chartW = W - padL - padR, chartH = H - padT - padB;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Positive and negative tone over time" style="width:${W}px;overflow:visible">`;

  for (const v of [0, 25, 50, 75, 100]) {
    const y = padT + chartH - (v / 100) * chartH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#1a1a1a" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="#525252" font-size="10">${v}%</text>`;
  }

  const series = [
    { key: "posPct", color: "#4ade80", label: "Positive" },
    { key: "neuPct", color: "#737373", label: "Neutral" },
    { key: "negPct", color: "#f87171", label: "Negative" },
  ];

  if (useBars) {
    // Stacked 100% bars per bucket
    const barW = Math.min(32, (chartW / labels.length) * 0.65);
    const stride = labelStride(labels.length, chartW);
    for (let i = 0; i < labels.length; i++) {
      const x = padL + (i + 0.5) * (chartW / labels.length);
      let y = padT + chartH;
      for (const s of series) {
        const h = (filtered[i][s.key] / 100) * chartH;
        y -= h;
        svg += `<rect x="${x - barW / 2}" y="${y}" width="${barW}" height="${h}" fill="${s.color}" opacity="0.85" rx="2" ${tooltip(`${s.label}: ${filtered[i][s.key].toFixed(1)}% in ${labels[i]} (${filtered[i].postCount} posts)`)}/>`;
      }
      if (i % stride === 0 || i === labels.length - 1) {
        svg += `<text x="${x}" y="${H - padB + 8}" text-anchor="end" fill="#a3a3a3" font-size="10" font-weight="500" transform="rotate(-35 ${x} ${H - padB + 8})">${labels[i]}</text>`;
      }
    }
  } else {
    // Area/line chart for longer periods
    const xStep = labels.length > 1 ? chartW / (labels.length - 1) : 0;
    const stride = labelStride(labels.length, chartW);

    svg += `<defs>
      <linearGradient id="posGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4ade80" stop-opacity="0.3"/><stop offset="100%" stop-color="#4ade80" stop-opacity="0"/></linearGradient>
      <linearGradient id="negGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f87171" stop-opacity="0.3"/><stop offset="100%" stop-color="#f87171" stop-opacity="0"/></linearGradient>
    </defs>`;

    for (const s of series) {
      if (s.key !== "neuPct") {
        let areaPath = "";
        for (let i = 0; i < filtered.length; i++) {
          const x = padL + i * xStep;
          const y = padT + chartH - (filtered[i][s.key] / 100) * chartH;
          areaPath += (i === 0 ? "M" : "L") + x + " " + y + " ";
        }
        areaPath += `L ${padL + (filtered.length - 1) * xStep} ${padT + chartH} L ${padL} ${padT + chartH} Z`;
        svg += `<path d="${areaPath}" fill="url(#${s.key === 'posPct' ? 'posGrad' : 'negGrad'})"/>`;
      }
      let path = "";
      for (let i = 0; i < filtered.length; i++) {
        const x = padL + i * xStep;
        const y = padT + chartH - (filtered[i][s.key] / 100) * chartH;
        path += (i === 0 ? "M" : "L") + x + " " + y + " ";
      }
      svg += `<path d="${path}" stroke="${s.color}" stroke-width="2" fill="none"/>`;
      for (let i = 0; i < filtered.length; i++) {
        const x = padL + i * xStep;
        const y = padT + chartH - (filtered[i][s.key] / 100) * chartH;
        svg += `<circle cx="${x}" cy="${y}" r="3" fill="${s.color}" ${tooltip(`${s.label}: ${filtered[i][s.key].toFixed(1)}% in ${labels[i]} (${filtered[i].postCount} posts)`)}/>`;
      }
    }

    for (let i = 0; i < labels.length; i++) {
      if (i % stride !== 0 && i !== labels.length - 1) continue;
      const x = padL + i * xStep;
      svg += `<text x="${x}" y="${H - padB + 8}" text-anchor="end" fill="#a3a3a3" font-size="10" font-weight="500" transform="rotate(-35 ${x} ${H - padB + 8})">${labels[i]}</text>`;
    }
  }

  svg += "</svg>";

  const legend = `<div class="chart-legend">
    <div class="legend-item"><div class="legend-dot" style="background:#4ade80"></div>Positive</div>
    <div class="legend-item"><div class="legend-dot" style="background:#737373"></div>Neutral</div>
    <div class="legend-item"><div class="legend-dot" style="background:#f87171"></div>Negative</div>
  </div>`;

  const title = "How did the language shift?";
  const sub = useBars
    ? `Positive/neutral/negative tone per ${labels.length <= 7 ? 'day' : 'bucket'}. Each bar is 100%.`
    : "Percentage of positive/neutral/negative posts over time";

  return `<div class="chart-card"><div class="chart-card-title">${title}</div><div class="chart-card-sub">${sub}</div>${coverageNote}<div class="chart-scroll time-series-scroll">${svg}</div>${legend}</div>`;
}

// ─── 6. Volume chart (improved with area fill) ────────────────────────────

function renderVolumeChart(trajectory) {
  if (!trajectory || trajectory.length < 2) return "";
  const labels = trajectory.map(t => t.label);
  const W = chartWidth(labels.length), H = 220, padL = 55, padR = 20, padT = 20, padB = 70;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const maxPosts = Math.max(...trajectory.map(t => t.postCount), 1);
  const minPosts = Math.max(1, ...trajectory.map(t => t.postCount));
  const maxComments = Math.max(...trajectory.map(t => t.commentCount), 1);
  const groupW = chartW / labels.length;
  const barW = Math.min(14, groupW * 0.35);
  const stride = labelStride(labels.length, chartW);

  // Use log scale when the range is very skewed (max/min > 10)
  const useLog = maxPosts / minPosts > 10;
  const yMax = useLog ? maxPosts : maxPosts;
  const yScale = (v) => useLog
    ? Math.log10(v + 1) / Math.log10(yMax + 1)
    : v / yMax;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Post and reply-count volume over time" style="width:${W}px;overflow:visible">`;
  svg += `<defs><linearGradient id="postGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#22d3ee" stop-opacity="0.8"/><stop offset="100%" stop-color="#22d3ee" stop-opacity="0.2"/></linearGradient></defs>`;

  for (const f of [0, 0.25, 0.5, 0.75, 1.0]) {
    const raw = useLog ? Math.round(Math.pow(yMax + 1, f) - 1) : Math.round(yMax * f);
    const v = raw || 0;
    const y = padT + chartH - f * chartH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#1a1a1a" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="#525252" font-size="10">${v}</text>`;
  }

  for (let i = 0; i < labels.length; i++) {
    const cx = padL + i * groupW + groupW / 2;
    const ph = yScale(trajectory[i].postCount) * chartH;
    svg += `<rect x="${cx - barW - 1}" y="${padT + chartH - ph}" width="${barW}" height="${ph}" fill="url(#postGrad)" rx="2" ${tooltip(`${labels[i]}: ${trajectory[i].postCount} posts`)}/>`;
    const ch = yScale(trajectory[i].commentCount) * chartH;
    svg += `<rect x="${cx + 1}" y="${padT + chartH - ch}" width="${barW}" height="${ch}" fill="#a78bfa" opacity="0.7" rx="2" ${tooltip(`${labels[i]}: ${trajectory[i].commentCount} comments`)}/>`;
    if (i % stride === 0 || i === labels.length - 1) {
      svg += `<text x="${cx}" y="${H - padB + 8}" text-anchor="end" fill="#a3a3a3" font-size="10" font-weight="500" transform="rotate(-35 ${cx} ${H - padB + 8})">${labels[i]}</text>`;
    }
  }

  svg += "</svg>";
  const scaleNote = useLog ? `<div class="coverage-note">Y-axis uses log scale because post volume is highly skewed (max ${maxPosts}, min ${minPosts}).</div>` : "";
  const legend = `<div class="chart-legend"><div class="legend-item"><div class="legend-dot" style="background:#22d3ee"></div>Posts</div><div class="legend-item"><div class="legend-dot" style="background:#a78bfa"></div>Reddit reply-count metadata (scaled)</div></div>`;

  return `<div class="chart-card"><div class="chart-card-title">How did participation change?</div><div class="chart-card-sub">Collected posts and Reddit reply-count metadata across the selected time grain. Read the bars as relative activity, not complete Reddit volume.</div>${scaleNote}<div class="chart-scroll time-series-scroll">${svg}</div>${legend}</div>`;
}

// ─── 7. Moderation Summary (bar chart, replaces broken line chart) ────────

function renderModerationSummary(moderation) {
  if (!moderation) return "";
  const bars = [
    { label: "Controversial", count: moderation.controversial.length, pct: moderation.controversialPct, color: "#f87171" },
    { label: "Low upvote ratio", count: moderation.lowRatio, pct: moderation.lowRatioPct, color: "#fbbf24" },
    { label: "Deleted authors", count: moderation.deletedAuthors, pct: moderation.deletedPct, color: "#a78bfa" },
    { label: "Flagged (slop/AI)", count: moderation.flagged, pct: moderation.flaggedPct, color: "#fb923c" },
    { label: "Locked", count: moderation.lockedPosts, pct: (moderation.lockedPosts / moderation.totalPosts) * 100, color: "#60a5fa" },
    { label: "NSFW", count: moderation.over18, pct: (moderation.over18 / moderation.totalPosts) * 100, color: "#e879f9" },
  ];

  const maxPct = Math.max(...bars.map(b => b.pct), 1);
  const W = 500, barH = 28, gap = 6;
  const padL = 130, padR = 80, padT = 10, padB = 10;
  const H = padT + bars.length * (barH + gap) + padB;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Moderation proxy metrics" style="width:100%;max-width:${W}px;height:auto">`;

  bars.forEach((b, i) => {
    const y = padT + i * (barH + gap);
    const w = (b.pct / maxPct) * (W - padL - padR);
    svg += `<text x="${padL - 8}" y="${y + barH / 2 + 4}" text-anchor="end" fill="#e5e5e5" font-size="11">${b.label}</text>`;
    svg += `<rect x="${padL}" y="${y}" width="${w}" height="${barH}" rx="4" fill="${b.color}" opacity="0.75" ${tooltip(`${b.label}: ${b.count} posts (${b.pct.toFixed(1)}%)`)}/>`;
    svg += `<text x="${padL + w + 6}" y="${y + barH / 2 + 4}" fill="#737373" font-size="10">${b.count} (${b.pct.toFixed(1)}%)</text>`;
  });

  svg += "</svg>";
  return `<div class="chart-card"><div class="chart-card-title">Where does friction appear?</div><div class="chart-card-sub">Observable moderation proxies from post metadata. These are warning signals, not direct moderator-action records.</div><div class="chart-scroll">${svg}</div></div>`;
}

// ─── 8. Engagement Scatter Plot (score vs comments) ───────────────────────

function renderEngagementScatter(data, reportRef) {
  if (!data || data.length < 1) return "";
  const W = 700, H = 400, padL = 60, padR = 20, padT = 20, padB = 50;
  const chartW = W - padL - padR, chartH = H - padT - padB;

  const maxScore = Math.max(...data.map(d => d.score), 1);
  const maxComments = Math.max(...data.map(d => d.comments), 1);
  const logScore = (v) => v <= 0 ? 0 : Math.log10(v + 1) / Math.log10(maxScore + 1);
  const logComments = (v) => v <= 0 ? 0 : Math.log10(v + 1) / Math.log10(maxComments + 1);

  // Build topic label → color map from report.topics (sorted by count)
  const topicColorMap = {};
  (reportRef?.topics || []).forEach((t, i) => { topicColorMap[t.label] = TOPIC_COLORS[i % TOPIC_COLORS.length]; });

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Post engagement by score and reply count" style="width:100%;height:auto">`;

  for (const f of [0, 0.25, 0.5, 0.75, 1.0]) {
    const y = padT + chartH - f * chartH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#1a1a1a" stroke-width="1"/>`;
    const x = padL + f * chartW;
    svg += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + chartH}" stroke="#1a1a1a" stroke-width="1"/>`;
  }

  svg += `<text x="${padL + chartW / 2}" y="${H - 10}" text-anchor="middle" fill="#a3a3a3" font-size="11">Post Score (log scale)</text>`;
  svg += `<text x="15" y="${padT + chartH / 2}" text-anchor="middle" fill="#a3a3a3" font-size="11" transform="rotate(-90 15 ${padT + chartH / 2})">Comments (log scale)</text>`;

  for (const f of [0, 0.5, 1.0]) {
    const v = Math.round(Math.pow(maxScore + 1, f) - 1);
    const x = padL + f * chartW;
    svg += `<text x="${x}" y="${padT + chartH + 18}" text-anchor="middle" fill="#525252" font-size="10">${v}</text>`;
    const vc = Math.round(Math.pow(maxComments + 1, f) - 1);
    const y = padT + chartH - f * chartH;
    svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="#525252" font-size="10">${vc}</text>`;
  }

  for (const d of data) {
    const x = padL + logScore(d.score) * chartW;
    const y = padT + chartH - logComments(d.comments) * chartH;
    const topicLabel = typeof d.topic === "object" ? d.topic.topic : (reportRef?.topics?.[d.topic]?.label || "Unclassified");
    const color = topicColorMap[topicLabel] || "#737373";
    const r = Math.max(2, Math.min(8, Math.sqrt(d.score + 1) / 8));
    const tip = `${esc(d.title)}\nScore: ${d.score} | Comments: ${d.comments} | Upvote: ${(d.upvoteRatio * 100).toFixed(0)}% | ${esc(d.flair)}`;
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="0.6" ${tooltip(tip)}/>`;
  }

  svg += "</svg>";
  const legend = `<div class="chart-legend">${(reportRef?.topics || []).slice(0, 6).map((t, i) => `<div class="legend-item"><div class="legend-dot" style="background:${TOPIC_COLORS[i % TOPIC_COLORS.length]}"></div>${esc(t.label)}</div>`).join("")}</div>`;

  return `<div class="chart-card"><div class="chart-card-title">Which posts broke through?</div><div class="chart-card-sub">Each dot is a post. Moving right means higher score; moving up means more replies. Both axes use log scales so outliers do not flatten the rest.</div><div class="chart-scroll">${svg}</div>${legend}</div>`;
}

// ─── 9. Flair Donut Chart ─────────────────────────────────────────────────

function renderFlairDonut(moderation) {
  if (!moderation?.flairDist) return "";
  const flairs = moderation.flairDist.slice(0, 10);
  const total = flairs.reduce((s, [, c]) => s + c, 0);
  const W = 400, H = 280, cx = 130, cy = 130, r = 90, rInner = 50;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Post flair distribution" style="width:100%;max-width:400px;height:auto">`;
  let angle = -Math.PI / 2;
  const colors = ["#22d3ee","#a78bfa","#f59e0b","#4ade80","#f87171","#60a5fa","#fb923c","#e879f9","#34d399","#facc15"];

  for (let i = 0; i < flairs.length; i++) {
    const [flair, count] = flairs[i];
    const fraction = count / total;
    const endAngle = angle + fraction * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const xi1 = cx + rInner * Math.cos(endAngle), yi1 = cy + rInner * Math.sin(endAngle);
    const xi2 = cx + rInner * Math.cos(angle), yi2 = cy + rInner * Math.sin(angle);
    const largeArc = fraction > 0.5 ? 1 : 0;
    const path = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${rInner} ${rInner} 0 ${largeArc} 0 ${xi2} ${yi2} Z`;
    svg += `<path d="${path}" fill="${colors[i % colors.length]}" opacity="0.85" ${tooltip(`${flair}: ${count} (${(fraction * 100).toFixed(1)}%)`)}/>`;
    angle = endAngle;
  }

  svg += `<text x="${cx}" y="${cy - 5}" text-anchor="middle" fill="#e5e5e5" font-size="14" font-weight="600">${total}</text>`;
  svg += `<text x="${cx}" y="${cy + 12}" text-anchor="middle" fill="#737373" font-size="10">posts</text>`;
  svg += "</svg>";

  const legend = `<div class="flair-legend">${flairs.map(([flair, count], i) =>
    `<div class="flair-legend-item"><div class="legend-dot" style="background:${colors[i % colors.length]}"></div><span>${esc(flair)}</span><span class="flair-count">${count}</span></div>`
  ).join("")}</div>`;

  return `<div class="chart-card"><div class="chart-card-title">How is discussion organized?</div><div class="chart-card-sub">The most-used post flairs reveal the community's own working categories.</div><div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">${svg}${legend}</div></div>`;
}

// ─── 10. Score Distribution Histogram (log bins) ──────────────────────────

function renderScoreHistogram(histogram) {
  if (!histogram || histogram.length < 1) return "";
  const W = 700, H = 220, padL = 55, padR = 20, padT = 20, padB = 50;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const maxCount = Math.max(...histogram.map(h => h.count), 1);
  const barW = chartW / histogram.length;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Post score distribution" style="width:100%;height:auto">`;
  svg += `<defs><linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#22d3ee" stop-opacity="0.9"/><stop offset="100%" stop-color="#22d3ee" stop-opacity="0.3"/></linearGradient></defs>`;

  for (const f of [0, 0.5, 1.0]) {
    const v = Math.round(maxCount * f);
    const y = padT + chartH - f * chartH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#1a1a1a" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="#525252" font-size="10">${v}</text>`;
  }

  for (let i = 0; i < histogram.length; i++) {
    const h = histogram[i];
    const bh = (h.count / maxCount) * chartH;
    const x = padL + i * barW;
    svg += `<rect x="${x + 1}" y="${padT + chartH - bh}" width="${barW - 2}" height="${bh}" fill="url(#histGrad)" rx="2" ${tooltip(`${h.range}: ${h.count} posts`)}/>`;
    svg += `<text x="${x + barW / 2}" y="${H - padB + 18}" text-anchor="middle" fill="#525252" font-size="9">${h.range}</text>`;
  }

  svg += `<text x="${padL + chartW / 2}" y="${H - 5}" text-anchor="middle" fill="#a3a3a3" font-size="11">Post Score Range (log bins)</text>`;
  svg += "</svg>";

  return `<div class="chart-card"><div class="chart-card-title">How concentrated is attention?</div><div class="chart-card-sub">Post counts by score band. Logarithmic bands keep the long tail and breakout posts visible together.</div><div class="chart-scroll">${svg}</div></div>`;
}

// ─── 10b. Comment Karma Distribution ──────────────────────────────────────

function renderCommentKarmaHistogram(data) {
  if (!data || !data.buckets || data.totalStored === 0) return "";
  const { buckets, totalStored, postsWithStoredComments } = data;
  const W = 700, H = 260, padL = 55, padR = 20, padT = 30, padB = 55;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  const barW = chartW / buckets.length;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Comment karma distribution" style="width:100%;height:auto">`;
  svg += `<defs><linearGradient id="commentKarmaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5d9ca3" stop-opacity="0.95"/><stop offset="100%" stop-color="#31575d" stop-opacity="0.45"/></linearGradient></defs>`;

  // Gridlines
  for (const f of [0, 0.25, 0.5, 0.75, 1.0]) {
    const v = Math.round(maxCount * f);
    const y = padT + chartH - f * chartH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#273239" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="#9ca6a9" font-size="11">${v}</text>`;
  }

  // Bars
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const bh = (b.count / maxCount) * chartH;
    const x = padL + i * barW;
    const pct = totalStored > 0 ? (b.count / totalStored * 100).toFixed(1) : "0.0";
    svg += `<rect x="${x + 2}" y="${padT + chartH - bh}" width="${barW - 4}" height="${bh}" fill="url(#commentKarmaGrad)" rx="2" ${tooltip(`${b.range} karma: ${b.count} comments (${pct}%)`)}/>`;
    if (b.count > 0 && bh > 12) {
      svg += `<text x="${x + barW / 2}" y="${padT + chartH - bh + 12}" text-anchor="middle" fill="#e5e5e5" font-size="9" font-weight="600">${pct}%</text>`;
    }
    svg += `<text x="${x + barW / 2}" y="${H - padB + 18}" text-anchor="middle" fill="#9ca6a9" font-size="10">${b.range}</text>`;
  }

  svg += `<text x="${padL + chartW / 2}" y="${H - 5}" text-anchor="middle" fill="#9ca6a9" font-size="11">Stored comment score</text>`;
  svg += "</svg>";

  const coveragePct = postsWithStoredComments > 0 && totalStored > 0
    ? `<div class="coverage-note">${totalStored.toLocaleString()} stored comments across ${postsWithStoredComments.toLocaleString()} posts. Karma = net upvotes minus downvotes.</div>`
    : "";

  return `<div class="chart-card"><div class="chart-card-title">How were stored comments received?</div><div class="chart-card-sub">Comment bodies grouped by their recorded Reddit score. This uses the captured reply corpus, not reply-count metadata.</div>${coveragePct}<div class="chart-scroll">${svg}</div></div>`;
}

// ─── 11. Topic Distribution Table (full, scrollable) ──────────────────────

function renderTopicTable(breakdown) {
  if (!breakdown) return "";
  const labels = breakdown.buckets || breakdown.months || [];
  const topics = breakdown.topics || [];
  const matrix = breakdown.matrix || [];
  const bucketTotals = matrix.map(row => row.reduce((a, b) => a + b, 0));

  // Sort topics by total volume
  const topicTotals = topics.map((_, ti) => matrix.reduce((s, row) => s + row[ti], 0));
  const sortedIdx = topicTotals.map((_, i) => i).sort((a, b) => topicTotals[b] - topicTotals[a]);

  let table = `<div class="chart-scroll"><table class="data-table"><thead><tr><th>Topic</th>`;
  for (const m of labels) table += `<th>${m}</th>`;
  table += `<th>Total</th></tr></thead><tbody>`;
  for (const ti of sortedIdx) {
    table += `<tr><td class="topic-name"><div class="legend-dot" style="background:${TOPIC_COLORS[sortedIdx.indexOf(ti) % TOPIC_COLORS.length]};display:inline-block;margin-right:6px"></div>${esc(topics[ti])}</td>`;
    for (let mi = 0; mi < labels.length; mi++) {
      const val = matrix[mi][ti];
      table += `<td style="${val === 0 ? 'color:#404040' : ''}">${val || "·"}</td>`;
    }
    table += `<td><strong>${topicTotals[ti]}</strong></td></tr>`;
  }
  table += `<tr class="totals-row"><td><strong>Total</strong></td>`;
  for (let mi = 0; mi < labels.length; mi++) {
    const t = bucketTotals[mi];
    table += `<td style="${t < 20 ? 'color:#fbbf24' : ''}"><strong>${t}</strong></td>`;
  }
  table += `<td><strong>${bucketTotals.reduce((a,b)=>a+b,0)}</strong></td></tr></tbody></table></div>`;
  table += `<div class="coverage-note">Yellow totals = under 20 posts (under-sampled)</div>`;

  return `<div class="chart-card"><div class="chart-card-title">Topic Distribution Table</div><div class="chart-card-sub">Full time-bucket breakdown, sorted by total volume</div>${table}</div>`;
}

// ─── Period Comparison Cards (7d/30d/365d vs previous) ───────────────────

function renderPeriodComparisons(comparisons) {
  if (!comparisons || comparisons.length === 0) return "";
  const labels = { 7: "Last 7 days", 30: "Last 30 days", 365: "Last year" };

  return comparisons.map(cmp => {
    const label = labels[cmp.days] || `Last ${cmp.days} days`;
    const prevLabel = `vs previous ${cmp.days}d`;
    const r = cmp.recent, p = cmp.previous, d = cmp.deltas;

    const deltaArrow = (val, invert = false) => {
      const v = val === 0 ? 0 : val;
      if (v === 0) return `<span class="delta-flat">→ 0.00</span>`;
      const positive = invert ? v < 0 : v > 0;
      const sign = v > 0 ? "+" : "";
      return positive
        ? `<span class="delta-up">↑ ${sign}${v.toFixed(2)}</span>`
        : `<span class="delta-down">↓ ${sign}${v.toFixed(2)}</span>`;
    };
    const pctDelta = (recent, prev) => {
      if (prev === 0) return recent > 0 ? "+∞%" : "0.00%";
      const v = ((recent - prev) / prev) * 100;
      return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
    };

    return `<div class="period-card">
      <div class="period-header">${label} <span class="period-vs">${prevLabel}</span></div>
      <div class="period-metrics">
        <div class="period-metric">
          <div class="pm-label">Posts</div>
          <div class="pm-value">${fmtCompact(r.posts)}</div>
          <div class="pm-delta">${deltaArrow(d.posts)} <span class="pm-pct">${pctDelta(r.posts, p.posts)}</span></div>
        </div>
        <div class="period-metric">
          <div class="pm-label">Reply count</div>
          <div class="pm-value">${fmtCompact(r.comments)}</div>
          <div class="pm-delta">${deltaArrow(d.comments)} <span class="pm-pct">${pctDelta(r.comments, p.comments)}</span></div>
        </div>
        <div class="period-metric">
          <div class="pm-label">Avg score</div>
          <div class="pm-value">${r.avgScore.toFixed(2)}</div>
          <div class="pm-delta">${deltaArrow(d.avgScore)}</div>
        </div>
        <div class="period-metric">
          <div class="pm-label">Avg reply count/post</div>
          <div class="pm-value">${r.avgComments.toFixed(2)}</div>
          <div class="pm-delta">${deltaArrow(d.avgComments)}</div>
        </div>
        <div class="period-metric">
          <div class="pm-label">Positive tone</div>
          <div class="pm-value">${r.posPct.toFixed(2)}%</div>
          <div class="pm-delta">${deltaArrow(d.posPct)}</div>
        </div>
        <div class="period-metric">
          <div class="pm-label">Negative tone</div>
          <div class="pm-value">${r.negPct.toFixed(2)}%</div>
          <div class="pm-delta">${deltaArrow(d.negPct, true)}</div>
        </div>
        <div class="period-metric">
          <div class="pm-label">Controversial</div>
          <div class="pm-value">${r.controversial}</div>
          <div class="pm-delta">${deltaArrow(d.controversial, true)}</div>
        </div>
        <div class="period-metric">
          <div class="pm-label">Deleted</div>
          <div class="pm-value">${r.deleted}</div>
          <div class="pm-delta">${deltaArrow(d.deleted, true)}</div>
        </div>
      </div>
    </div>`;
  }).join("");
}

// ─── Weekly Metrics Chart ─────────────────────────────────────────────────

function renderWeeklyChart(weekly) {
  if (!weekly || weekly.length < 2) return "";
  // Show last 26 weeks (6 months) for readability
  const data = weekly.slice(-26);
  if (data.filter(week => week.posts > 0).length < 2) return "";
  const W = chartWidth(data.length), H = 260, padL = 50, padR = 20, padT = 20, padB = 70;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const maxPosts = Math.max(...data.map(w => w.posts), 1);
  const xStep = data.length > 1 ? chartW / (data.length - 1) : 0;
  const stride = Math.max(1, Math.ceil(data.length / 12));

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly post volume and average score" style="width:${W}px;overflow:visible">`;
  svg += `<defs><linearGradient id="weekGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#22d3ee" stop-opacity="0.8"/><stop offset="100%" stop-color="#22d3ee" stop-opacity="0.2"/></linearGradient></defs>`;

  // Gridlines
  for (const f of [0, 0.25, 0.5, 0.75, 1.0]) {
    const v = Math.round(maxPosts * f);
    const y = padT + chartH - f * chartH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#1a1a1a" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="#525252" font-size="10">${v}</text>`;
  }

  // Bars for posts
  const barW = Math.min(12, xStep * 0.6);
  for (let i = 0; i < data.length; i++) {
    const x = padL + i * xStep;
    const bh = (data[i].posts / maxPosts) * chartH;
    svg += `<rect x="${x - barW / 2}" y="${padT + chartH - bh}" width="${barW}" height="${bh}" fill="url(#weekGrad)" rx="2" ${tooltip(`Week of ${data[i].label}: ${data[i].posts} posts, ${data[i].comments} comments, avg score ${data[i].avgScore}`)}/>`;
  }

  // Line for avg score (scaled to max)
  const maxAvgScore = Math.max(...data.map(w => w.avgScore), 1);
  let scorePath = "";
  for (let i = 0; i < data.length; i++) {
    const x = padL + i * xStep;
    const y = padT + chartH - (data[i].avgScore / maxAvgScore) * chartH * 0.8;
    scorePath += (i === 0 ? "M" : "L") + x + " " + y + " ";
  }
  svg += `<path d="${scorePath}" stroke="#f59e0b" stroke-width="2" fill="none" opacity="0.8"/>`;
  for (let i = 0; i < data.length; i++) {
    const x = padL + i * xStep;
    const y = padT + chartH - (data[i].avgScore / maxAvgScore) * chartH * 0.8;
    svg += `<circle cx="${x}" cy="${y}" r="2.5" fill="#f59e0b" ${tooltip(`Avg score: ${data[i].avgScore}`)}/>`;
  }

  // X labels
  for (let i = 0; i < data.length; i++) {
    if (i % stride !== 0 && i !== data.length - 1) continue;
    const x = padL + i * xStep;
    svg += `<text x="${x}" y="${H - padB + 8}" text-anchor="end" fill="#a3a3a3" font-size="9" transform="rotate(-35 ${x} ${H - padB + 8})">${data[i].label}</text>`;
  }

  svg += "</svg>";
  const legend = `<div class="chart-legend">
    <div class="legend-item"><div class="legend-dot" style="background:#22d3ee"></div>Posts per week</div>
    <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div>Avg score (scaled)</div>
  </div>`;

  return `<div class="chart-card"><div class="chart-card-title">How did activity move week to week?</div><div class="chart-card-sub">Weekly post volume with average score overlaid for the selected research window.</div><div class="chart-scroll time-series-scroll">${svg}</div>${legend}</div>`;
}

// ─── Last 7 Days Daily Breakdown ──────────────────────────────────────────

function renderDailyBreakdown(daily) {
  if (!daily || daily.length === 0) return "";
  if (daily.filter(day => day.posts > 0).length < 2) return "";
  const W = 600, H = 280, padL = 50, padR = 20, padT = 30, padB = 50;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const maxPosts = Math.max(...daily.map(d => d.posts), 1);
  const maxComments = Math.max(...daily.map(d => d.comments), 1);
  const groupW = chartW / daily.length;
  const barW = Math.min(30, groupW * 0.3);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily post and reply-count totals" style="width:${W}px;overflow:visible">`;
  svg += `<defs><linearGradient id="dayGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#22d3ee" stop-opacity="0.8"/><stop offset="100%" stop-color="#22d3ee" stop-opacity="0.2"/></linearGradient></defs>`;

  // Gridlines
  for (const f of [0, 0.5, 1.0]) {
    const v = Math.round(maxPosts * f);
    const y = padT + chartH - f * chartH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#1a1a1a" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="#525252" font-size="10">${v}</text>`;
  }

  for (let i = 0; i < daily.length; i++) {
    const d = daily[i];
    const cx = padL + i * groupW + groupW / 2;
    const ph = (d.posts / maxPosts) * chartH;
    svg += `<rect x="${cx - barW - 2}" y="${padT + chartH - ph}" width="${barW}" height="${ph}" fill="url(#dayGrad)" rx="3" ${tooltip(`${d.dayName} ${d.date}: ${d.posts} posts, ${d.comments} comments, avg score ${d.avgScore}, ${d.posPct}%+ / ${d.negPct}%-`)}/>`;
    const ch = (d.comments / maxComments) * chartH;
    svg += `<rect x="${cx + 2}" y="${padT + chartH - ch}" width="${barW}" height="${ch}" fill="#a78bfa" opacity="0.7" rx="3" ${tooltip(`${d.dayName} ${d.date}: ${d.comments} comments`)}/>`;
    // Day label
    svg += `<text x="${cx}" y="${H - padB + 18}" text-anchor="middle" fill="#a3a3a3" font-size="10" font-weight="500">${d.dayName}</text>`;
    svg += `<text x="${cx}" y="${H - padB + 32}" text-anchor="middle" fill="#525252" font-size="8">${d.date.slice(5)}</text>`;
    // Post count on top of bar
    if (d.posts > 0) {
      svg += `<text x="${cx}" y="${padT + chartH - ph - 5}" text-anchor="middle" fill="#22d3ee" font-size="10" font-weight="600">${d.posts}</text>`;
    }
  }

  svg += "</svg>";
  const legend = `<div class="chart-legend"><div class="legend-item"><div class="legend-dot" style="background:#22d3ee"></div>Posts</div><div class="legend-item"><div class="legend-dot" style="background:#a78bfa"></div>Reddit reply-count metadata</div></div>`;

  return `<div class="chart-card"><div class="chart-card-title">What changed day by day?</div><div class="chart-card-sub">Daily post volume and Reddit reply-count metadata for the selected short window.</div><div class="chart-scroll time-series-scroll">${svg}</div>${legend}</div>`;
}

// ─── Tone bar renderer ────────────────────────────────────────────────────

function renderToneBar(tone) {
  const total = tone.total || 1;
  const posW = (tone.pos / total) * 100;
  const neuW = (tone.neu / total) * 100;
  const negW = (tone.neg / total) * 100;
  return `<div class="tone-bar">
    <div class="seg pos" style="width:${posW}%">${posW > 8 ? pct(tone.pos, total) : ""}</div>
    <div class="seg neu" style="width:${neuW}%">${neuW > 8 ? pct(tone.neu, total) : ""}</div>
    <div class="seg neg" style="width:${negW}%">${negW > 8 ? pct(tone.neg, total) : ""}</div>
  </div>`;
}

function renderEmotions(emotions) {
  if (!emotions) return "";
  const entries = Object.entries(emotions).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return `<div class="emotion-grid">${entries.map(([e, c]) =>
    `<div class="emotion-cell"><div class="emotion-name">${e}</div><div class="emotion-val">${c}</div></div>`
  ).join("")}</div>`;
}

function canonicalRedditUrl(permalink) {
  if (!permalink) return null;
  return permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`;
}

function hasCommentCorpus(report) {
  return report?.coverage?.comments?.available === true || report?.commentCorpus?.available === true;
}

function renderPhaseSpine(evolution) {
  if (!evolution?.phases?.length) return `<div class="empty-state">Historical phases are not available for this report yet.</div>`;
  const total = evolution.phases.reduce((sum, phase) => sum + phase.monthCount, 0) || 1;
  return `<div class="phase-spine" role="list" aria-label="Community phases">
    ${evolution.phases.map((phase, index) => `<article class="phase" role="listitem" style="--phase-span:${Math.max(1, phase.monthCount / total * 12)}">
      <div class="phase-index">${String(index + 1).padStart(2, "0")}</div>
      <div class="phase-period">${esc(phase.period)}</div>
      <h3>${evolution.collectionOnly ? `${fmtNum(phase.totalPosts)} observed posts` : esc(phase.dominantTopic)}</h3>
      <p>${evolution.collectionOnly ? `${phase.monthCount} ${phase.monthCount === 1 ? "month" : "months"} represented` : `${phase.dominantPct}% of ${fmtNum(phase.totalPosts)} sampled posts · ${phase.monthCount} ${phase.monthCount === 1 ? "month" : "months"}`}</p>
    </article>`).join("")}
  </div>`;
}

function renderYearlyActivity(evolution) {
  const phases = evolution?.phases || [];
  if (!phases.length) return "";
  const maxPosts = Math.max(...phases.map(phase => phase.totalPosts), 1);
  return `<div class="chart-card yearly-activity"><div class="chart-card-title">Posts by year</div><div class="chart-card-sub">Collected post volume across the available historical record</div><div class="year-bars">${phases.map(phase => `<div class="year-row"><time>${esc(phase.period)}</time><div class="year-track"><span style="width:${Math.max(2, phase.totalPosts / maxPosts * 100)}%"></span></div><strong>${fmtNum(phase.totalPosts)}</strong></div>`).join("")}</div></div>`;
}

function renderResearchConclusion(subreddit, report, collectionOnly) {
  const trajectory = (report.toneTrajectory || []).filter(point => point.postCount > 0);
  const peak = trajectory.reduce((best, point) => !best || point.postCount > best.postCount ? point : best, null);
  const topPost = report.topPosts?.[0];
  const leadTopic = report.topics?.[0];
  const commentCoverage = report.commentCorpus?.totalStored || 0;
  return `<section class="research-conclusion" aria-labelledby="conclusion-title">
    <div class="conclusion-heading"><span>Research readout</span><h2 id="conclusion-title">What this record establishes.</h2><p>A concise handoff from charts to evidence. These are corpus observations, not causal or cross-source claims.</p></div>
    <div class="conclusion-ledger">
      <article><span>01 · Activity</span><strong>${peak ? `${esc(peak.label)} is the highest represented period at ${fmtNum(peak.postCount)} posts.` : `${fmtNum(report.totals.posts)} posts are represented across the selected record.`}</strong></article>
      <article><span>02 · Conversation</span><strong>${collectionOnly || !leadTopic ? "Topic direction awaits enrichment; the activity and source corpus are ready now." : `${esc(leadTopic.label)} is the largest detected topic cluster (${fmtNum(leadTopic.count)} matched texts).`}</strong></article>
      <article><span>03 · Response</span><strong>${commentCoverage ? `${fmtNum(commentCoverage)} stored comment bodies can support reply-level follow-up.` : `${fmtNum(report.totals.comments)} Reddit reply counts are available as metadata; comment-body interpretation is not claimed.`}</strong></article>
      <article><span>04 · Strongest evidence</span><strong>${topPost ? `<a href="${esc(canonicalRedditUrl(topPost.permalink))}" target="_blank" rel="noopener noreferrer">${esc(topPost.title)}</a> · ${fmtNum(topPost.score)} score` : "No source-linked post is available for this window."}</strong></article>
    </div>
    <div class="signal-handoff"><div><span>HiSignal handoff</span><strong>Candidate packet refreshed for r/${esc(subreddit)}</strong></div><p>Observed Reddit evidence only. HiSignal must map entities and corroborate it against other sources before publication.</p></div>
  </section>`;
}

function renderCommentCoverageDirectory(rows, totals) {
  const communitiesWithComments = rows.filter(row => row.storedComments > 0).length;
  const overallPostCoverage = totals.posts ? totals.postsWithStoredComments / totals.posts * 100 : 0;
  const overallCapture = totals.replyCountMetadata ? totals.storedComments / totals.replyCountMetadata * 100 : 0;
  return `<details class="comment-directory">
    <summary><div><strong>Comment coverage across all communities</strong><span>${fmtNum(totals.storedComments)} stored bodies · ${communitiesWithComments}/${rows.length} communities</span></div><span>Inspect coverage</span></summary>
    <div class="comment-directory-body">
      <div class="coverage-explainer"><strong>Comments are a partial layer.</strong><p>Stored bodies appear on ${overallPostCoverage.toFixed(1)}% of collected posts. They equal ${overallCapture.toFixed(1)}% of Reddit reply-count metadata overall; the two measures are not guaranteed to describe the same retrievable universe, so treat that ratio as a collection-depth indicator—not completeness.</p></div>
      <label class="coverage-search-label" for="coverage-search">Filter 113 communities</label><input id="coverage-search" class="coverage-search" type="search" placeholder="Search community…">
      <div class="chart-scroll"><table class="data-table coverage-table"><thead><tr><th>Community</th><th>Posts</th><th>Posts with stored bodies</th><th>Stored comment bodies</th><th>Reply-count metadata</th><th>Depth indicator</th></tr></thead><tbody>${rows.map(row => `<tr data-coverage-community="${esc(row.community.toLowerCase())}"><td><a href="?subreddit=${encodeURIComponent(row.community)}&period=all">r/${esc(row.community)}</a></td><td>${fmtNum(row.posts)}</td><td>${fmtNum(row.postsWithStoredComments)} <span>${row.postCoveragePct.toFixed(1)}%</span></td><td><strong>${fmtNum(row.storedComments)}</strong></td><td>${fmtNum(row.replyCountMetadata)}</td><td>${row.capturePct.toFixed(2)}%</td></tr>`).join("")}</tbody></table></div>
    </div>
  </details>`;
}

function renderChangeLedger(evolution) {
  const movers = [...(evolution?.topicEmergence || [])]
    .filter(topic => topic.trend !== "stable")
    .sort((a, b) => Math.abs((b.secondHalfAvg || 0) - (b.firstHalfAvg || 0)) - Math.abs((a.secondHalfAvg || 0) - (a.firstHalfAvg || 0)))
    .slice(0, 6);
  if (!movers.length) return `<div class="empty-state">No directional topic changes met the report threshold.</div>`;
  return `<div class="change-ledger">${movers.map(topic => {
    const rising = topic.trend === "growing";
    const delta = (topic.secondHalfAvg || 0) - (topic.firstHalfAvg || 0);
    return `<article class="change-row">
      <span class="change-mark ${rising ? "rise" : "fall"}" aria-hidden="true">${rising ? "↗" : "↘"}</span>
      <div><h3>${esc(topic.topic)}</h3><p>First seen ${topic.firstMonth || "—"} · peak ${topic.peakMonth} (${fmtNum(topic.peakCount)})</p></div>
      <div class="change-value"><strong>${delta > 0 ? "+" : ""}${delta.toFixed(1)}</strong><span>avg posts / period</span></div>
    </article>`;
  }).join("")}</div>`;
}

function renderTurningPoints(evolution) {
  const shifts = evolution?.keyShifts || [];
  if (!shifts.length) return `<div class="empty-state">No topic crossovers were detected at the current sampling threshold.</div>`;
  return `<ol class="turning-points">${shifts.slice(-8).reverse().map(shift => `<li>
    <time>${esc(shift.month)}</time>
    <p><strong>${esc(shift.to)}</strong> overtook ${esc(shift.from)}</p>
  </li>`).join("")}</ol>`;
}

function buildHighSignalExport(subreddit, report) {
  const evidencePosts = [...(report.topPosts || [])]
    .filter(post => canonicalRedditUrl(post.permalink))
    .sort((a, b) => (b.score + b.comments * 2) - (a.score + a.comments * 2))
    .slice(0, 20);
  return {
    schemaVersion: 1,
    source: "reddit-insights",
    generatedAt: report.generatedAt,
    community: subreddit,
    coverage: {
      from: report.totals?.dateRange?.start || null,
      to: report.totals?.dateRange?.end || null,
      posts: report.totals?.posts || 0,
      comments: hasCommentCorpus(report) ? (report.commentCorpus?.totalStored || 0) : 0,
      replyCountMetadata: report.totals?.comments || 0,
      evidenceKinds: hasCommentCorpus(report) ? ["post", "comment"] : ["post"],
      note: hasCommentCorpus(report) ? "Stored comment bodies are present and explicitly declared available." : "Post-only corpus. Reddit reply counts may be present as metadata, but comment-body analysis is unavailable."
    },
    qualification: "Candidate Reddit observations only. High Signal must independently map entities, corroborate across sources, score, and apply publication rules.",
    observations: evidencePosts.map(post => ({
      id: `reddit-insights:v1:${subreddit.toLowerCase()}:post:${post.permalink.split("/").filter(Boolean).at(3) || post.date}`,
      type: "high-engagement-post",
      community: subreddit,
      observedAt: post.date,
      title: post.title,
      metrics: { score: post.score, comments: post.comments, upvoteRatio: post.upvoteRatio },
      confidence: "observed",
      evidence: [{ kind: "post", url: canonicalRedditUrl(post.permalink), title: post.title, author: post.author || null }]
    }))
  };
}

// ─── HTML generator ───────────────────────────────────────────────────────

function renderDashboard(report, selectedPeriod = "all", subreddit = initialSubreddit, availableCommunities = communities, periodFallback = false) {
  const periodOptions = PERIODS.map(p => `<option value="${p.key}" ${p.key === selectedPeriod ? "selected" : ""}>${p.label}</option>`).join("");
  const communityDatalist = availableCommunities.map(name => `<option value="${esc(name)}">r/${esc(name)}</option>`).join("");
  const communityJson = JSON.stringify(availableCommunities).replace(/</g, "\\u003c");
  const hasComments = hasCommentCorpus(report);
  const collectionOnly = report.collectionOnly === true;
  const analyzedMonths = report.evolution?.analyzedMonths || 0;
  const totalMonths = report.evolution?.totalMonths || report.evolution?.months?.length || 0;
  const coveragePct = totalMonths > 0 ? Math.round(analyzedMonths / totalMonths * 100) : 0;
  const adaptiveTrend = selectedPeriod === "7d"
    ? renderDailyBreakdown(report.dailyData)
    : (selectedPeriod === "30d" || selectedPeriod === "90d")
      ? renderWeeklyChart(report.weeklyData)
      : renderVolumeChart(report.toneTrajectoryForChart);
  const chartBoard = collectionOnly ? [] : [
    adaptiveTrend,
    renderTopicStreamgraph(report.topicBreakdownForChart),
    renderToneChart(report.toneTrajectoryForChart),
    renderEngagementScatter(report.engagementScatter, report),
    renderScoreHistogram(report.scoreHistogram),
    renderActivityHeatmap(report.activityGrid),
    renderModerationSummary(report.moderation),
    renderFlairDonut(report.moderation),
    hasComments ? renderCommentKarmaHistogram(report.commentKarma) : "",
    renderTopContributors(report.topContributors),
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reddit Insights — r/${esc(subreddit)}</title>
<style>
  :root {
    --bg:#0a0a0a; --surface:#111; --surface2:#161616; --border:#222; --border2:#2a2a2a;
    --text:#e5e5e5; --dim:#737373; --dimmer:#525252;
    --accent:#22d3ee; --accent2:#a78bfa;
    --pos:#4ade80; --neg:#f87171; --warn:#fbbf24;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body {
    font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
    background:var(--bg); color:var(--text); line-height:1.6;
    padding:2rem; max-width:1400px; margin:0 auto;
  }

  /* Header */
  .header { margin-bottom:2rem; }
  h1 { font-size:1.75rem; font-weight:700; letter-spacing:-0.02em; }
  h1 .accent { color:var(--accent); }
  .subtitle { color:var(--dim); font-size:0.85rem; margin-top:0.25rem; }

  /* Summary cards */
  .summary-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:0.75rem; margin-bottom:2rem; }
  .summary-card {
    background:var(--surface); border:1px solid var(--border); border-radius:10px;
    padding:1rem 1.2rem; transition:border-color 0.2s;
  }
  .summary-card:hover { border-color:var(--border2); }
  .summary-card .label { font-size:0.7rem; color:var(--dim); text-transform:uppercase; letter-spacing:0.05em; font-weight:600; }
  .summary-card .value { font-size:1.5rem; font-weight:700; font-variant-numeric:tabular-nums; margin-top:0.2rem; }
  .summary-card .value.good { color:var(--pos); }
  .summary-card .value.warn { color:var(--warn); }
  .summary-card .value.bad { color:var(--neg); }
  .summary-card .sub-label { font-size:0.7rem; color:var(--dimmer); margin-top:0.15rem; }

  /* Chart grid */
  .chart-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(580px,1fr)); gap:1rem; margin-bottom:1.5rem; }
  .chart-card {
    background:var(--surface); border:1px solid var(--border); border-radius:10px;
    padding:1.2rem; transition:border-color 0.2s;
  }
  .chart-card:hover { border-color:var(--border2); }
  .chart-card-title { font-size:0.95rem; font-weight:600; color:var(--text); }
  .chart-card-sub { font-size:0.75rem; color:var(--dim); margin-bottom:0.75rem; }
  .chart-scroll { overflow-x:auto; padding-bottom:6px; }
  .chart-scroll svg { display:block; }
  .coverage-note { font-size:0.75rem; color:var(--warn); margin-bottom:0.5rem; }

  /* Chart elements */
  .chart-legend { display:flex; flex-wrap:wrap; gap:0.75rem; margin-top:0.6rem; font-size:0.75rem; color:var(--dim); }
  .legend-item { display:flex; align-items:center; gap:0.35rem; }
  .legend-dot { width:10px; height:10px; border-radius:3px; flex-shrink:0; }
  .flair-legend { display:flex; flex-direction:column; gap:0.3rem; font-size:0.8rem; }
  .flair-legend-item { display:flex; align-items:center; gap:0.4rem; }
  .flair-count { color:var(--dim); margin-left:auto; font-variant-numeric:tabular-nums; }

  /* Tone bar */
  .tone-bar { display:flex; height:24px; border-radius:6px; overflow:hidden; margin:0.5rem 0; }
  .tone-bar .seg { display:flex; align-items:center; justify-content:center; font-size:0.7rem; font-weight:600; }
  .tone-bar .pos { background:var(--pos); color:#063; }
  .tone-bar .neu { background:#2a2a2a; color:#aaa; }
  .tone-bar .neg { background:var(--neg); color:#600; }
  .emotion-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(100px,1fr)); gap:0.4rem; margin-top:0.5rem; }
  .emotion-cell { background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:0.5rem; }
  .emotion-name { font-size:0.7rem; color:var(--dim); }
  .emotion-val { font-size:1rem; font-weight:600; font-variant-numeric:tabular-nums; }

  /* Tables */
  .data-table { width:100%; border-collapse:collapse; font-size:0.78rem; }
  .data-table th { text-align:left; color:var(--dim); padding:0.35rem 0.5rem; border-bottom:1px solid var(--border2); font-weight:500; white-space:nowrap; }
  .data-table td { padding:0.35rem 0.5rem; border-bottom:1px solid var(--border); font-variant-numeric:tabular-nums; white-space:nowrap; }
  .data-table .topic-name { white-space:normal; max-width:180px; }
  .data-table .totals-row td { border-top:2px solid var(--border2); }
  .data-table .delta-up { color:var(--pos); }
  .data-table .delta-down { color:var(--neg); }
  .data-table .delta-flat { color:var(--dim); }
  .leader-table { min-width:900px; table-layout:fixed; }
  .leader-table th:first-child { width:38px; }
  .leader-table th:nth-child(2) { width:42%; }
  .leader-table .post-title-cell { white-space:normal; line-height:1.35; }
  .table-scroll-note { display:none; margin-bottom:.4rem; color:var(--dim); font-size:.7rem; }

  /* Collapsible sections */
  details { margin-bottom:0.75rem; }
  details > summary {
    cursor:pointer; list-style:none; padding:0.7rem 0;
    font-size:1.1rem; font-weight:600; color:var(--accent);
    border-bottom:1px solid var(--border);
    display:flex; align-items:center; gap:0.5rem; user-select:none;
    transition:color 0.15s;
  }
  details > summary:hover { color:var(--text); }
  details > summary::-webkit-details-marker { display:none; }
  details > summary::before { content:"▶"; font-size:0.65rem; transition:transform 0.2s; color:var(--dim); }
  details[open] > summary::before { transform:rotate(90deg); }
  details > summary .badge { margin-left:auto; }
  .badge { display:inline-block; padding:0.15rem 0.6rem; border-radius:4px; font-size:0.72rem; font-weight:600; }
  .badge-ok { background:#0d3320; color:var(--pos); }
  .badge-no { background:#3d1212; color:var(--neg); }
  .badge-info { background:#0c2d3d; color:var(--accent); }
  .section-content { padding-top:0.75rem; padding-bottom:0.5rem; }

  /* Cards within sections */
  .card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:1rem 1.2rem; margin-bottom:0.75rem; }
  .sub { color:var(--dim); font-size:0.82rem; }

  /* Question groups */
  .q-group .q-text { font-weight:500; }
  .q-group .q-meta { color:var(--dim); font-size:0.78rem; margin-top:0.2rem; }
  .q-group .q-instances { color:var(--dim); font-size:0.75rem; margin-left:1rem; margin-top:0.3rem; }
  .q-group details > summary { font-size:0.9rem; color:var(--text); font-weight:500; border:none; padding:0.3rem 0; }
  .q-group details > summary::before { content:"▸"; }
  .q-group details[open] > summary::before { transform:rotate(90deg); }

  /* Comment groups */
  .comment-group { background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:0.75rem; margin-top:0.5rem; }
  .comment-group .cg-meta { color:var(--dim); font-size:0.75rem; margin-bottom:0.3rem; }
  .comment-group .cg-body { font-size:0.82rem; }
  .comment-group .cg-members { margin-top:0.5rem; border-left:2px solid var(--border); padding-left:0.75rem; }
  .comment-group .cg-member { font-size:0.78rem; color:var(--dim); margin-bottom:0.3rem; }
  .comment-group .cg-member .score { color:var(--accent); font-weight:600; }
  .comment-group .cg-other { color:var(--dim); font-style:italic; }

  /* Topic clusters */
  .topic-row { display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid var(--border); }
  .topic-row:last-child { border-bottom:none; }
  .topic-label { font-weight:500; }
  .topic-count { color:var(--accent); font-variant-numeric:tabular-nums; font-size:0.82rem; }
  .topic-examples { color:var(--dim); font-size:0.76rem; margin-top:0.2rem; }

  /* Health grid */
  .health-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:0.5rem; }
  .health-cell { background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:0.7rem; }
  .health-cell .label { font-size:0.7rem; color:var(--dim); }
  .health-cell .value { font-size:1.1rem; font-weight:600; font-variant-numeric:tabular-nums; }
  .health-cell .value.good { color:var(--pos); }
  .health-cell .value.warn { color:var(--warn); }
  .health-cell .value.bad { color:var(--neg); }

  /* Tone comparison */
  .tone-comparison { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
  .tone-col h3 { font-size:0.85rem; color:var(--dim); margin-bottom:0.3rem; }
  .author-list { font-size:0.82rem; color:var(--dim); }
  .author-list .author { color:var(--text); }
  .drift-row { display:flex; justify-content:space-between; padding:0.4rem 0; font-size:0.82rem; border-bottom:1px solid var(--border); }
  .drift-row:last-child { border-bottom:none; }

  /* SVG hover */
  svg circle:hover, svg rect:hover { filter:brightness(1.3); }

  /* Period comparison cards */
  .period-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(380px,1fr)); gap:1rem; margin-bottom:1.5rem; }
  .period-card { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:1.2rem; }
  .period-card:hover { border-color:var(--border2); }
  .period-header { font-size:1rem; font-weight:600; margin-bottom:0.75rem; }
  .period-vs { font-size:0.72rem; color:var(--dim); font-weight:400; margin-left:0.5rem; }
  .period-metrics { display:grid; grid-template-columns:repeat(4,1fr); gap:0.6rem; }
  .period-metric { background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:0.5rem; text-align:center; }
  .pm-label { font-size:0.65rem; color:var(--dim); text-transform:uppercase; letter-spacing:0.04em; }
  .pm-value { font-size:1.1rem; font-weight:700; font-variant-numeric:tabular-nums; margin-top:0.15rem; }
  .pm-delta { font-size:0.7rem; margin-top:0.1rem; font-variant-numeric:tabular-nums; }
  .pm-pct { color:var(--dim); font-size:0.65rem; }
  .delta-up { color:var(--pos); font-weight:600; }
  .delta-down { color:var(--neg); font-weight:600; }
  .delta-flat { color:var(--dim); }

  /* Period selector */
  .period-selector { margin-bottom:1.5rem; display:flex; align-items:center; gap:0.75rem; }
  .period-selector label { color:var(--dim); font-size:0.85rem; }
  .period-selector select { background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:0.5rem 0.75rem; font-size:0.9rem; cursor:pointer; }
  .period-selector select:hover { border-color:var(--border2); }

  /* Temporal Atlas */
  :root {
    --bg:#090d10; --surface:#0f1519; --surface2:#172025; --border:#273239; --border2:#46545c;
    --text:#e8e4db; --dim:#9ca6a9; --dimmer:#748087; --accent:#d66b49; --accent2:#5d9ca3;
    --pos:#83b879; --neg:#df755d; --warn:#d3a65c;
  }
  html { scroll-behavior:smooth; background:var(--bg); }
  body { max-width:1560px; padding:0 2rem 4rem; font-family:Arial,Helvetica,sans-serif; line-height:1.45; }
  a { color:var(--accent); text-underline-offset:3px; }
  :focus-visible { outline:3px solid #d87863; outline-offset:3px; }
  .research-header { position:sticky; top:0; z-index:20; margin:0 -2rem 2rem; padding:1rem 2rem; background:rgba(9,13,16,.97); border-bottom:1px solid var(--border); }
  .masthead { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:.8rem; }
  .brand { display:flex; align-items:baseline; gap:.75rem; }
  .brand-name { font:700 1.05rem/1 Arial,sans-serif; letter-spacing:-.02em; }
  .brand-purpose { color:var(--dim); font-size:.78rem; }
  .research-controls { display:grid; grid-template-columns:minmax(260px,1fr) minmax(180px,.45fr) auto; gap:1rem; align-items:end; }
  .control label { display:block; margin-bottom:.25rem; color:var(--dim); font-size:.7rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
  .control select,.control input { width:100%; min-height:44px; padding:.55rem 2.2rem .55rem .7rem; color:var(--text); background:var(--surface); border:1px solid var(--border2); border-radius:4px; font:600 .9rem Arial,sans-serif; }
  .coverage-chip { min-height:44px; display:flex; align-items:center; gap:.5rem; padding:.55rem .75rem; background:var(--surface2); color:var(--text); border:1px solid var(--border2); border-radius:4px; font-size:.76rem; white-space:nowrap; }
  .coverage-chip::before { content:""; width:8px; height:8px; background:${hasComments ? "#83b879" : "#d3a65c"}; border-radius:50%; }
  .atlas-hero { display:grid; grid-template-columns:minmax(0,1.15fr) minmax(210px,.45fr) minmax(260px,.55fr); gap:1.5rem; padding:1rem 0 2.5rem; border-bottom:1px solid var(--border2); }
  .atlas-kicker { color:var(--accent); font:700 .72rem/1 Arial,sans-serif; letter-spacing:.08em; text-transform:uppercase; }
  .atlas-hero h1 { max-width:18ch; margin:.65rem 0 .8rem; font:700 clamp(2.35rem,5vw,5.2rem)/.94 Georgia,serif; letter-spacing:-.035em; text-wrap:balance; }
  .atlas-deck { max-width:68ch; color:var(--dim); font-size:1rem; }
  .atlas-meta { display:grid; align-content:end; gap:.8rem; }
  .meta-line { display:flex; justify-content:space-between; gap:1rem; padding:.65rem 0; border-bottom:1px solid var(--border); font-size:.8rem; }
  .meta-line span { color:var(--dim); }
  .meta-line strong { text-align:right; font-variant-numeric:tabular-nums; }
  .evidence-peek { align-self:stretch; padding:1rem; background:var(--surface); border:1px solid var(--border); }
  .evidence-peek-head { display:flex; align-items:baseline; justify-content:space-between; gap:1rem; padding-bottom:.7rem; border-bottom:1px solid var(--border); }
  .evidence-peek-head h2 { font:700 1.05rem/1 Georgia,serif; }
  .evidence-peek-head span { color:var(--dim); font-size:.72rem; }
  .evidence-item { display:block; padding:.65rem 0; color:var(--text); border-bottom:1px solid var(--border); text-decoration:none; }
  .evidence-item:hover strong { color:var(--accent); }
  .evidence-item strong { display:block; font-size:.8rem; line-height:1.35; overflow-wrap:anywhere; }
  .evidence-item span { display:block; margin-top:.25rem; color:var(--dim); font-size:.7rem; }
  .fallback-note { margin:0 0 1rem; padding:.7rem .85rem; background:#2a2113; color:#ebca8d; border:1px solid #705b35; font-size:.82rem; }
  .research-section { padding:4rem 0; border-bottom:1px solid var(--border); }
  .section-heading { display:grid; grid-template-columns:minmax(180px,.4fr) minmax(0,1fr); gap:2rem; margin-bottom:1.4rem; }
  .section-heading h2 { font:700 clamp(1.45rem,2.5vw,2.35rem)/1 Georgia,serif; letter-spacing:-.025em; }
  .section-heading p { max-width:70ch; color:var(--dim); }
  .phase-spine { display:flex; align-items:stretch; gap:1px; background:var(--border2); border:1px solid var(--border2); overflow-x:auto; }
  .phase { flex:var(--phase-span) 1 180px; min-width:180px; padding:1rem; background:var(--surface); }
  .phase-index { color:var(--accent); font:700 .7rem/1 Arial,sans-serif; }
  .phase-period { margin-top:2rem; color:var(--dim); font-size:.72rem; }
  .phase h3 { margin:.25rem 0 .45rem; font:700 1.05rem/1.1 Georgia,serif; }
  .phase p { color:var(--dim); font-size:.72rem; }
  .year-bars { display:grid; gap:.65rem; margin-top:1rem; }
  .year-row { display:grid; grid-template-columns:4.5rem minmax(0,1fr) 4rem; gap:.7rem; align-items:center; }
  .year-row time,.year-row strong { font-size:.72rem; font-variant-numeric:tabular-nums; }
  .year-row strong { text-align:right; }
  .year-track { height:16px; background:var(--surface2); border:1px solid var(--border); }
  .year-track span { display:block; height:100%; background:var(--accent2); }
  .atlas-grid { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(260px,.7fr); gap:2rem; }
  .change-ledger { border-top:2px solid var(--text); }
  .change-row { display:grid; grid-template-columns:2rem minmax(0,1fr) auto; gap:.8rem; align-items:center; padding:.85rem 0; border-bottom:1px solid var(--border); }
  .change-mark { font-size:1.4rem; }
  .change-mark.rise { color:var(--pos); } .change-mark.fall { color:var(--neg); }
  .change-row h3 { font-size:.9rem; } .change-row p { color:var(--dim); font-size:.72rem; }
  .change-value { text-align:right; font-variant-numeric:tabular-nums; }
  .change-value strong,.change-value span { display:block; } .change-value span { color:var(--dim); font-size:.65rem; }
  .turning-points { list-style:none; border-top:2px solid var(--text); }
  .turning-points li { display:grid; grid-template-columns:5rem 1fr; gap:.7rem; padding:.85rem 0; border-bottom:1px solid var(--border); }
  .turning-points time { color:var(--accent); font:700 .72rem/1.4 Arial,sans-serif; }
  .turning-points p { font-size:.78rem; }
  .empty-state { padding:1rem; color:var(--dim); background:var(--surface2); font-size:.8rem; }
  .summary-grid { grid-template-columns:repeat(4,1fr); gap:0; border:1px solid var(--border); }
  .summary-card { border:0; border-right:1px solid var(--border); border-radius:0; background:var(--surface); }
  .summary-card:nth-child(4n) { border-right:0; }
  .summary-card .value { font-family:Georgia,serif; }
  .chart-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:2rem; }
  #changes .chart-grid > .chart-card:last-child:nth-child(odd) { grid-column:1 / -1; }
  .chart-grid.single { grid-template-columns:1fr; }
  .chart-card,.period-card,.card { border-radius:4px; box-shadow:none; background:var(--surface); }
  .chart-card { min-width:0; overflow:hidden; }
  .chart-card-title { font-family:Georgia,serif; font-size:1rem; }
  .chart-scroll { max-width:100%; }
  .chart-scroll svg { width:100% !important; max-width:100%; height:auto; }
  details > summary { color:var(--text); font-family:Georgia,serif; }
  .research-archive { margin-top:4rem; }
  .period-comparison-disclosure { margin-bottom:2.5rem; border-top:1px solid var(--border2); border-bottom:1px solid var(--border2); }
  .period-comparison-disclosure > summary { padding:1.2rem 0; font-size:1.05rem; }
  .period-comparison-disclosure[open] > summary { margin-bottom:1rem; }
  .app-shell { display:block; width:min(100%,1280px); margin:0 auto; }
  .app-shell > *, main { min-width:0; }
  .analysis-family { margin:1rem 0 1.5rem; border-top:1px solid var(--border2); }
  .analysis-family > summary { padding:1rem 0; }
  .chart-atlas-head { display:flex; justify-content:space-between; gap:2rem; align-items:start; padding:1.5rem 0; }
  .chart-atlas-head h3 { font:700 1.4rem/1.1 Georgia,serif; }
  .chart-atlas-head p { max-width:70ch; margin-top:.4rem; color:var(--dim); }
  .lead-chart > .chart-card { padding:1.4rem; }
  .supporting-charts { margin-top:2rem; border-top:1px solid var(--border2); }
  .supporting-charts > summary { padding:1.25rem 0; font-size:1.05rem; }
  .supporting-charts[open] > summary { margin-bottom:1.5rem; }
  .chart-atlas .chart-grid { align-items:start; }
  .chart-atlas .chart-card { padding:1.2rem; }
  .chart-atlas .chart-card-title { font-size:1.2rem; line-height:1.15; }
  .chart-atlas .chart-card-sub { max-width:68ch; margin-top:.3rem; color:var(--dim); font-size:.8rem; line-height:1.45; }
  .research-conclusion { margin:3.5rem 0 1rem; border-top:1px solid var(--border2); }
  .conclusion-heading { display:grid; grid-template-columns:minmax(180px,.55fr) minmax(0,.8fr) minmax(280px,1fr); gap:1.5rem; align-items:start; padding:2rem 0; }
  .conclusion-heading > span,.conclusion-ledger article > span,.signal-handoff span { color:var(--accent); font-size:.7rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
  .conclusion-heading h2 { font:700 clamp(2rem,4vw,3.7rem)/.95 Georgia,serif; letter-spacing:-.03em; }
  .conclusion-heading p { max-width:55ch; color:var(--dim); }
  .conclusion-ledger { border-top:2px solid var(--text); }
  .conclusion-ledger article { display:grid; grid-template-columns:180px minmax(0,1fr); gap:1.5rem; padding:1.15rem 0; border-bottom:1px solid var(--border); }
  .conclusion-ledger article strong { max-width:75ch; font-size:.95rem; line-height:1.4; }
  .conclusion-ledger a { color:var(--text); text-decoration-color:var(--accent); text-underline-offset:3px; }
  .signal-handoff { display:grid; grid-template-columns:minmax(260px,.7fr) minmax(0,1fr); gap:1.5rem; margin-top:1rem; padding:1.2rem; background:var(--surface); border:1px solid var(--border2); }
  .signal-handoff strong,.signal-handoff span { display:block; }
  .signal-handoff strong { margin-top:.35rem; font-family:Georgia,serif; }
  .signal-handoff p { color:var(--dim); font-size:.8rem; }
  .comment-directory { margin:3rem 0 1rem; border-top:1px solid var(--border2); border-bottom:1px solid var(--border2); }
  .comment-directory > summary { display:flex; justify-content:space-between; gap:2rem; align-items:center; padding:1.4rem 0; }
  .comment-directory > summary div strong,.comment-directory > summary div span { display:block; }
  .comment-directory > summary div strong { font:700 1.1rem/1.2 Georgia,serif; }
  .comment-directory > summary div span,.comment-directory > summary > span { margin-top:.25rem; color:var(--dim); font:600 .72rem/1.3 Arial,sans-serif; }
  .comment-directory-body { padding:0 0 1.5rem; }
  .coverage-explainer { display:grid; grid-template-columns:minmax(180px,.4fr) minmax(0,1fr); gap:2rem; padding:1.25rem; background:var(--surface); }
  .coverage-explainer strong { font-family:Georgia,serif; }
  .coverage-explainer p { max-width:75ch; color:var(--dim); }
  .coverage-search-label { display:block; margin-top:1.5rem; color:var(--dim); font-size:.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
  .coverage-search { width:min(100%,420px); margin:.45rem 0 1rem; padding:.7rem; color:var(--text); background:var(--surface); border:1px solid var(--border2); border-radius:3px; }
  .coverage-table td span { color:var(--dim); }
  .empty-analysis { display:none; }
  .aggregate-note { margin-top:.75rem; color:var(--dim); font-size:.75rem; }
  @media (max-width:900px) {
    body { padding:0 1.25rem 3rem; }
    .research-header { margin:0 -1.25rem 1.5rem; padding:1rem 1.25rem; position:relative; }
    .research-controls,.atlas-hero,.atlas-grid,.section-heading,.chart-guide,.conclusion-heading,.signal-handoff { grid-template-columns:1fr; }
    .app-shell { width:100%; min-width:0; }
    main,.atlas-hero,.chart-grid,.chart-card,.evidence-peek { min-width:0; max-width:100%; }
    .chart-grid { grid-template-columns:1fr; }
    .chart-atlas-head,.comment-directory > summary { align-items:flex-start; }
    .coverage-explainer { grid-template-columns:1fr; gap:.5rem; }
    .conclusion-ledger article { grid-template-columns:1fr; gap:.4rem; }
    .summary-grid { grid-template-columns:repeat(2,1fr); }
    .summary-card:nth-child(odd) { border-right:1px solid var(--border); }
    .summary-card:nth-child(even) { border-right:0; }
    .atlas-meta { grid-template-columns:repeat(2,1fr); }
  }
  @media (max-width:520px) {
    body { padding:0 .85rem 2rem; }
    .research-header { margin:0 -.85rem 1.2rem; padding:.85rem; }
    .masthead { align-items:flex-start; flex-direction:column; }
    .research-controls { gap:.5rem; }
    .coverage-chip { white-space:normal; }
    .atlas-hero h1 { max-width:100%; font-size:clamp(2rem,12vw,2.65rem); overflow-wrap:anywhere; }
    .atlas-meta { grid-template-columns:1fr; }
    .summary-grid,.tone-comparison,.period-metrics { grid-template-columns:1fr 1fr; }
    .period-row { grid-template-columns:1fr; }
    .chart-card,.card,.period-card { padding:.85rem; }
    .change-row { grid-template-columns:1.6rem minmax(0,1fr); }
    .change-value { grid-column:2; text-align:left; }
    .data-table { font-size:.7rem; }
    .table-scroll-note { display:block; }
    .chart-scroll svg { width:auto !important; min-width:560px; }
  }
  @media (prefers-reduced-motion:reduce) { html { scroll-behavior:auto; } }
</style></head><body>

<header class="research-header">
  <div class="masthead"><div class="brand"><span class="brand-name">Reddit Insights</span><span class="brand-purpose">A longitudinal research atlas</span></div><nav aria-label="Research sections"><a href="#evolution">Eras</a> · <a href="#changes">Changes</a> · <a href="#archive">Charts & evidence</a></nav></div>
  <div class="research-controls">
    <div class="control"><label for="subreddit-select">Search 113 communities</label><input id="subreddit-select" list="community-options" value="${esc(subreddit)}" autocomplete="off" onchange="navigateResearch()"><datalist id="community-options">${communityDatalist}</datalist></div>
    <div class="control"><label for="period-select">Research window</label><select id="period-select" onchange="navigateResearch()">${periodOptions}</select></div>
    <div class="coverage-chip">${hasComments ? `${fmtNum(report.commentCorpus?.totalStored || 0)} stored comments · ${fmtNum(report.commentCorpus?.postsWithStoredComments || 0)} posts covered` : "Post corpus only · no stored comment bodies"}</div>
  </div>
</header>

${periodFallback ? `<div class="fallback-note" role="status">That research window is not available for r/${esc(subreddit)}. Showing the all-time report instead.</div>` : ""}

<div class="app-shell"><main>
<section class="atlas-hero">
  <div><div class="atlas-kicker">${collectionOnly ? "Collected community record" : "Enriched community research"} · ${esc(selectedPeriod === "all" ? "all available history" : PERIODS.find(p => p.key === selectedPeriod)?.label || selectedPeriod)}</div><h1>How r/${esc(subreddit)} evolved.</h1><p class="atlas-deck">${collectionOnly ? `Explore the collected activity and source record from ${report.totals.dateRange.start} to ${report.totals.dateRange.end}. Topic eras will deepen as enrichment runs, but the community is fully searchable and research-ready now.` : `Trace the community’s dominant eras, topic crossovers, participation, and source record from ${report.totals.dateRange.start} to ${report.totals.dateRange.end}. This is sampled history: coverage is evidence, not completeness.`}</p></div>
  <div class="atlas-meta">
    <div class="meta-line"><span>Observed posts</span><strong>${fmtNum(report.totals.posts)}</strong></div>
    <div class="meta-line"><span>Months represented</span><strong>${fmtNum(totalMonths)} months with collected posts</strong></div>
    <div class="meta-line"><span>${collectionOnly ? "Collection completeness" : "Represented months analyzed"}</span><strong>${collectionOnly ? "Unknown" : `${analyzedMonths}/${totalMonths || "—"} above threshold`}</strong></div>
    <div class="meta-line"><span>Report generated</span><strong>${new Date(report.generatedAt).toLocaleDateString()}</strong></div>
  </div>
  <aside class="evidence-peek"><div class="evidence-peek-head"><h2>Source evidence</h2><span>${fmtNum(report.topPosts?.length || 0)} ranked</span></div>${(report.topPosts || []).slice(0, 5).map(post => `<a class="evidence-item" href="${esc(canonicalRedditUrl(post.permalink))}" target="_blank" rel="noopener noreferrer"><strong>${esc(post.title)}</strong><span>${fmtNum(post.score)} score · ${fmtNum(post.comments)} replies · ${esc(post.date)}</span></a>`).join("")}</aside>
</section>

<section class="research-section" id="evolution">
  <div class="section-heading"><h2>${collectionOnly ? "Collection timeline" : "Community eras"}</h2><p>${collectionOnly ? "Year bands show the collected post record. They establish historical coverage without inventing topic phases before enrichment." : "Dominant topics define broad phases only where a month has enough posts to analyze. Sparse months remain part of the record but do not manufacture a phase."}</p></div>
  ${renderPhaseSpine(report.evolution)}
  ${collectionOnly ? "" : `<p class="aggregate-note">Aggregate finding · representative source links are unavailable until the analyzer attaches post IDs to each topic-period result.</p>`}
</section>

${collectionOnly ? `<section class="research-section" id="changes"><div class="section-heading"><h2>Activity record</h2><p>Historical volume, attention, timing, and captured response derived directly from the collected corpus.</p></div><div class="chart-grid">${renderYearlyActivity(report.evolution)}${renderScoreHistogram(report.scoreHistogram)}${renderActivityHeatmap(report.activityGrid)}${renderEngagementScatter(report.engagementScatter, report)}${hasComments ? renderCommentKarmaHistogram(report.commentKarma) : ""}${renderTopContributors(report.topContributors)}</div></section>` : `<section class="research-section" id="changes">
  <div class="section-heading"><h2>What moved</h2><p>The strongest directional topic changes and detected crossovers. These are corpus observations, not causal claims.</p></div>
  <div class="atlas-grid"><div>${renderChangeLedger(report.evolution)}</div><div><h3 style="margin-bottom:.75rem;font-family:Georgia,serif">Turning points</h3>${renderTurningPoints(report.evolution)}</div></div>
  <p class="aggregate-note">Aggregate finding · use Topic Clusters and Top Posts below for corpus context. Direct source linkage awaits topic-period post IDs.</p>
</section>`}

${selectedPeriod === "all" && report.totals.posts > 0
  ? `<div class="coverage-note" style="margin-bottom:1rem">All-time view: this subreddit grew rapidly, so older months are sparse. Switch to <a href="?subreddit=${encodeURIComponent(subreddit)}&period=365d">Last year</a> or <a href="?subreddit=${encodeURIComponent(subreddit)}&period=90d">Last 90 days</a> for denser trend charts.</div>`
  : ""}
<section class="research-section" aria-labelledby="corpus-summary"><div class="section-heading"><h2 id="corpus-summary">Corpus at a glance</h2><p>Scale and quality context for the selected window. Counts describe the collected corpus, not all activity on Reddit.</p></div>
<div class="summary-grid">
  <div class="summary-card"><div class="label">Collected posts</div><div class="value">${fmtNum(report.totals.posts)}</div><div class="sub-label">across ${report.evolution?.totalMonths || report.evolution?.months?.length || 1} represented months</div></div>
  <div class="summary-card"><div class="label">Reply-count metadata</div><div class="value">${fmtNum(report.totals.comments)}</div><div class="sub-label">Reddit counts; bodies may not be stored</div></div>
  <div class="summary-card"><div class="label">Stored comment bodies</div><div class="value">${fmtNum(report.commentCorpus?.totalStored || 0)}</div><div class="sub-label">available for reply-level research</div></div>
  <div class="summary-card"><div class="label">Posts with stored bodies</div><div class="value">${fmtNum(report.commentCorpus?.postsWithStoredComments || 0)}</div><div class="sub-label">${report.totals.posts ? ((report.commentCorpus?.postsWithStoredComments || 0) / report.totals.posts * 100).toFixed(1) : "0.0"}% of collected posts</div></div>
</div>
</section>

${renderCommentCoverageDirectory(commentCoverageIndex, commentCoverageTotals)}

<div class="research-archive" id="archive">
<div class="section-heading"><h2>Research archive</h2><p>Detailed analytical figures, rankings, methodology proxies, and source records for the selected community and period.</p></div>

<!-- ─── Period Comparisons (7d/30d/365d) ─── -->
${report.periodComparisons?.length ? `<details class="period-comparison-disclosure"><summary>Period change summary</summary><div class="period-row">${renderPeriodComparisons(report.periodComparisons)}</div></details>` : ""}

${chartBoard.length ? `<section class="analysis-family chart-atlas"><div class="chart-atlas-head"><div><h3>Start here: participation over time</h3><p>The selected research window determines the time grain. Read this first, then open supporting views only when you need to explain the pattern.</p></div><span class="badge badge-info">${chartBoard.length} views</span></div><div class="lead-chart">${chartBoard[0]}</div>${chartBoard.length > 1 ? `<details class="supporting-charts"><summary>Explore ${chartBoard.length - 1} supporting charts</summary><div class="chart-grid">${chartBoard.slice(1).join("")}</div></details>` : ""}</section>` : ""}

<!-- ─── Top Posts Leaderboard ─── -->
<details><summary>Top Posts <span class="badge badge-info">${report.topPosts?.length || 0} posts</span></summary><div class="section-content">
${renderTopPosts(report.topPosts, "Top Posts by Score", "score")}
</div></details>

<details><summary>Most Commented Posts <span class="badge badge-info">${report.mostCommented?.length || 0} posts</span></summary><div class="section-content">
${renderTopPosts(report.mostCommented, "Most Commented Posts", "comment count")}
</div></details>

<!-- ─── Topic Distribution Table ─── -->
<details class="${report.topicBreakdown ? "" : "empty-analysis"}"><summary>Topic Distribution Table</summary><div class="section-content">
${renderTopicTable(report.topicBreakdown)}
</div></details>

<!-- ─── Recurring Questions ─── -->
<details class="${report.recurringQuestions.length ? "" : "empty-analysis"}"><summary>Recurring Questions <span class="badge ${report.recurringQuestions.length > 0 ? "badge-ok" : "badge-no"}">${report.recurringQuestions.length} groups</span></summary><div class="section-content">
${report.recurringQuestions.length === 0
  ? `<p class="sub">No recurring questions found.</p>`
  : report.recurringQuestions.slice(0, 20).map(q => `
    <div class="card q-group">
      <div class="q-text">${esc(q.question)}</div>
      <div class="q-meta">${q.count} instances · avg similarity ${q.avgSim.toFixed(3)}</div>
      <details><summary class="q-instances">Show ${q.instances.length} instances</summary><div class="q-instances">
        ${q.instances.map(inst => `<div>→ ${esc(inst.text)}${inst.date ? ` <span style="color:var(--dimmer)">(${new Date(inst.date * 1000).toISOString().slice(0,10)})</span>` : ""}</div>`).join("")}
      </div></details>
    </div>`).join("")
}
</div></details>

<!-- ─── Topic Clusters ─── -->
<details class="${report.topics.length ? "" : "empty-analysis"}"><summary>Topic Clusters <span class="badge badge-info">${report.topics.length} topics</span></summary><div class="section-content">
<p class="sub" style="margin-bottom:0.75rem">
  ${hasComments && !collectionOnly
    ? `Each of the ${report.totals.texts} texts (post titles, bodies, and explicitly available comment bodies) is assigned to the nearest topic by embedding similarity.`
    : `Topic assignments in this view are presented as post-corpus findings. Comment-body coverage is not explicitly declared, so comment-derived methodology is not claimed.`}
  <strong>Count</strong> = how many texts matched. <strong>Sim</strong> = average similarity to anchor. Examples show the most representative texts.
</p>
${report.topics.map(t => {
  const confidence = t.avgSim > 0.35 ? "high" : t.avgSim > 0.25 ? "medium" : "low";
  const confColor = confidence === "high" ? "var(--pos)" : (confidence === "medium" ? "var(--warn)" : "var(--neg)");
  return `
  <div class="card">
    <div class="topic-row">
      <span class="topic-label">${esc(t.label)}</span>
      <span class="topic-count">${t.count} texts · avg sim ${t.avgSim.toFixed(3)} · top sim ${t.topSim.toFixed(3)}</span>
    </div>
    <div style="font-size:0.72rem;color:${confColor};margin-bottom:0.3rem">Match confidence: ${confidence}</div>
    <div class="topic-examples">${t.examples.map((ex, i) => {
      const sim = t.exampleSims?.[i];
      const simStr = sim ? ` <span style="color:var(--dimmer);font-size:0.78rem">(sim ${sim.toFixed(2)})</span>` : "";
      return `→ ${esc(ex)}${simStr}`;
    }).join("<br>")}</div>
  </div>`;
}).join("")}
</div></details>

<!-- ─── Tone & Emotion ─── -->
<details class="${collectionOnly ? "empty-analysis" : ""}"><summary>Tone & Emotion</summary><div class="section-content">
<div class="card">
  <div class="tone-comparison">
    <div class="tone-col">
      <h3>Posts (${report.tone.posts.total})</h3>
      ${renderToneBar(report.tone.posts)}
      ${renderEmotions(report.tone.posts.emotions)}
    </div>
    ${hasComments ? `<div class="tone-col">
      <h3>Comments (${report.tone.comments.total})</h3>
      ${renderToneBar(report.tone.comments)}
      ${renderEmotions(report.tone.comments.emotions)}
    </div>` : `<div class="empty-state">Comment tone is unavailable until the analyzer explicitly declares comment-body coverage.</div>`}
  </div>
</div>
</div></details>

<!-- ─── Comment Groups ─── -->
<details class="${report.questionGroups.length ? "" : "empty-analysis"}"><summary>Answer Groups per Question <span class="badge badge-info">${hasComments ? report.questionGroups.length : 0} questions</span></summary><div class="section-content">
${hasComments ? report.questionGroups.map(qg => `
  <div class="card">
    <div class="q-text" style="font-weight:600">"${esc(qg.question)}"</div>
    <div class="q-meta">${qg.totalComments} comments · ${qg.commentGroups.length} answer groups</div>
    ${qg.commentGroups.map(g => `
      <details><summary><span style="font-size:0.85rem">${g.count === 1 ? "1 answer" : `${g.count} similar answers`} · avg score ${g.avgScore.toFixed(0)}</span></summary>
      <div class="comment-group">
        <div class="cg-meta">Representative: ${esc(g.representative.slice(0, 200))}</div>
        ${g.count > 1 ? `<div class="cg-members">${g.members.slice(0, 10).map(m => `<div class="cg-member"><span class="score">${m.score || 0}</span> ${esc(m.body.slice(0, 150))}</div>`).join("")}</div>` : ""}
      </div>
      </details>
    `).join("")}
  </div>`).join("") : `<div class="empty-state">Answer-group analysis requires an explicitly available comment corpus.</div>`}
</div></details>

<!-- ─── Evolution ─── -->
<details class="${collectionOnly ? "empty-analysis" : ""}"><summary>Evolution (Community Phases)${report.evolution?.phases ? ` <span class="badge badge-info">${report.evolution.phases.length} phases</span>` : ""}</summary><div class="section-content">
${report.evolution?.note
  ? `<p class="sub">${report.evolution.note}</p>`
  : report.evolution?.phases ? `<div class="card">
    <p class="sub">Analyzed ${report.evolution.analyzedMonths} of ${report.evolution.totalMonths} months (20+ posts each).</p>

    <div style="margin-top:1rem"><strong>Community phases (dominant topic per period):</strong></div>
    <div class="chart-scroll"><table class="data-table" style="margin-top:0.5rem">
      <thead><tr><th>Period</th><th>Dominant topic</th><th>% of posts</th><th>Months</th><th>Total posts</th></tr></thead>
      <tbody>
      ${report.evolution.phases.map(p => `<tr><td><strong>${esc(p.period)}</strong></td><td>${esc(p.dominantTopic)}</td><td>${p.dominantPct}%</td><td>${p.monthCount}</td><td>${p.totalPosts}</td></tr>`).join("")}
      </tbody>
    </table></div>

    <div style="margin-top:1.5rem"><strong>Topic emergence & trends:</strong></div>
    <div class="chart-scroll"><table class="data-table" style="margin-top:0.5rem">
      <thead><tr><th>Topic</th><th>First seen</th><th>Peak month</th><th>Peak count</th><th>Trend</th><th>Early avg</th><th>Recent avg</th></tr></thead>
      <tbody>
      ${report.evolution.topicEmergence.map(t => {
        const arrow = t.trend === "growing" ? "↑" : t.trend === "declining" ? "↓" : "→";
        const cls = t.trend === "growing" ? "delta-up" : t.trend === "declining" ? "delta-down" : "delta-flat";
        return `<tr><td>${esc(t.topic)}</td><td>${t.firstMonth || "—"}</td><td>${t.peakMonth}</td><td>${t.peakCount}</td><td class="${cls}">${arrow} ${t.trend}</td><td>${t.firstHalfAvg ?? "—"}</td><td>${t.secondHalfAvg ?? "—"}</td></tr>`;
      }).join("")}
      </tbody>
    </table></div>

    ${report.evolution.keyShifts?.length > 0 ? `
      <div style="margin-top:1.5rem"><strong>Key shifts (topic crossovers):</strong></div>
      <div style="margin-top:0.5rem">
      ${report.evolution.keyShifts.map(s => `<div class="drift-row"><span><strong>${s.month}</strong></span><span>${esc(s.from)} (${s.prevCounts[0]}) → ${esc(s.to)} (${s.currCounts[1]}) took over</span></div>`).join("")}
      </div>
    ` : ""}
  </div>` : `<p class="sub">No evolution data.</p>`
}
</div></details>

<!-- ─── Community Health ─── -->
<details><summary>Community Health</summary><div class="section-content">
<div class="card">
  <div class="health-grid">
    <div class="health-cell"><div class="label">Answer rate</div><div class="value ${report.health.answerRate > 70 ? "good" : "warn"}">${report.health.answerRate.toFixed(1)}%</div></div>
    <div class="health-cell"><div class="label">Avg reply count/post</div><div class="value">${report.health.avgCommentsPerPost.toFixed(1)}</div></div>
    <div class="health-cell"><div class="label">Posts with comments</div><div class="value">${report.health.postsWithComments}/${report.health.totalPosts}</div></div>
    <div class="health-cell"><div class="label">Median post score</div><div class="value">${report.health.medianScore}</div></div>
  </div>
  ${report.health.topAuthors.length > 0 ? `
    <div style="margin-top:1rem"><strong>Top contributors:</strong></div>
    <div class="author-list">${report.health.topAuthors.map(([a, c]) => `<span class="author">${esc(a)}</span> (${c} posts)`).join(" · ")}</div>
  ` : ""}
</div>
</div></details>

<!-- ─── Moderation ─── -->
<details class="${report.moderation ? "" : "empty-analysis"}"><summary>Moderation${report.moderation ? ` <span class="badge ${report.moderation.modScore > 80 ? "badge-ok" : "badge-no"}">${report.moderation.modScore}/100</span>` : ""}</summary><div class="section-content">
${report.moderation ? `<div class="card">
  <div class="health-grid">
    <div class="health-cell"><div class="label">Mod score</div><div class="value ${report.moderation.modScore > 80 ? "good" : "warn"}">${report.moderation.modScore}/100</div></div>
    <div class="health-cell"><div class="label">Avg upvote ratio</div><div class="value ${report.moderation.avgUpvoteRatio > 0.8 ? "good" : "warn"}">${(report.moderation.avgUpvoteRatio * 100).toFixed(1)}%</div></div>
    <div class="health-cell"><div class="label">Deleted authors</div><div class="value">${report.moderation.deletedAuthors} (${report.moderation.deletedPct.toFixed(1)}%)</div></div>
    <div class="health-cell"><div class="label">Deleted commenters</div><div class="value">${report.moderation.deletedCommentAuthors}</div></div>
    <div class="health-cell"><div class="label">Locked posts</div><div class="value">${report.moderation.lockedPosts}</div></div>
    <div class="health-cell"><div class="label">NSFW posts</div><div class="value">${report.moderation.over18}</div></div>
    <div class="health-cell"><div class="label">Flagged (slop/AI)</div><div class="value ${report.moderation.flaggedPct < 2 ? "good" : "warn"}">${report.moderation.flagged} (${report.moderation.flaggedPct.toFixed(1)}%)</div></div>
    <div class="health-cell"><div class="label">Controversial</div><div class="value ${report.moderation.controversialPct < 10 ? "good" : "warn"}">${report.moderation.controversial.length} (${report.moderation.controversialPct.toFixed(1)}%)</div></div>
    <div class="health-cell"><div class="label">Low upvote (<50%)</div><div class="value">${report.moderation.lowRatio} (${report.moderation.lowRatioPct.toFixed(1)}%)</div></div>
  </div>

  ${report.moderation.controversial.length > 0 ? `
    <div style="margin-top:1.5rem"><strong>Most controversial posts (30+ comments, <70% upvote):</strong></div>
    <div class="chart-scroll"><table class="data-table" style="margin-top:0.5rem">
      <thead><tr><th>Title</th><th>Score</th><th>Reply count</th><th>Upvote %</th><th>Flair</th></tr></thead>
      <tbody>
      ${report.moderation.controversial.map(c => `<tr><td style="max-width:400px">${esc(c.title)}</td><td>${c.score}</td><td>${c.comments}</td><td class="delta-down">${(c.upvoteRatio * 100).toFixed(0)}%</td><td>${esc(c.flair)}</td></tr>`).join("")}
      </tbody>
    </table></div>
  ` : ""}

  <p class="sub" style="margin-top:1rem">
    <strong>Mod score</strong> is a heuristic (0-100, higher = healthier). Penalizes: deleted authors (×2), controversial posts (×1.5), flagged posts (×3), low upvote ratio (×0.5).
    Reddit's API doesn't expose mod actions directly; these are proxy signals from post metadata.
  </p>
</div>` : `<p class="sub">No moderation data.</p>`}
</div></details>

</div>
${renderResearchConclusion(subreddit, report, collectionOnly)}
</main>
</div>

<script>
  const AVAILABLE_COMMUNITIES = ${communityJson};
  function navigateResearch() {
    const communityInput = document.getElementById('subreddit-select');
    const subreddit = communityInput.value;
    if (!AVAILABLE_COMMUNITIES.includes(subreddit)) {
      communityInput.setCustomValidity('Choose a collected community from the search results.');
      communityInput.reportValidity();
      return;
    }
    communityInput.setCustomValidity('');
    const period = document.getElementById('period-select').value;
    const params = new URLSearchParams({ subreddit, period });
    window.location.href = '?' + params.toString();
  }
  document.getElementById('subreddit-select')?.addEventListener('input', event => event.target.setCustomValidity(''));
  document.getElementById('coverage-search')?.addEventListener('input', event => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('[data-coverage-community]').forEach(row => { row.hidden = !row.dataset.coverageCommunity.includes(query); });
  });
  // Scroll time-series chart containers to the right end by default so the most recent data is visible
  document.querySelectorAll('.time-series-scroll').forEach(el => { el.scrollLeft = el.scrollWidth; });
</script>
</body></html>`;
}

const html = renderResearchStudio({ report: initialReports.all, selectedPeriod: "all", subreddit: initialSubreddit, availableCommunities: communities, periodCapabilities: Object.fromEntries(Object.entries(initialReports).map(([key, value]) => [key, Boolean(value?.topicBreakdown?.matrix?.length)])) });

// Save static HTML files for each period
const htmlFile = join(DATA_DIR, `${initialSubreddit}-report.html`);
if (!existsSync(dirname(htmlFile))) mkdirSync(dirname(htmlFile), { recursive: true });
writeFileSync(htmlFile, html);
console.log(`  Static HTML saved to ${htmlFile}`);

function refreshHighSignalExport(community, report) {
  const exportFile = join(DATA_DIR, `${community}-high-signal.json`);
  writeFileSync(exportFile, JSON.stringify(buildHighSignalExport(community, report), null, 2) + "\n");
}
refreshHighSignalExport(initialSubreddit, initialReports.all);
console.log(`  High Signal candidate export refreshed for ${initialSubreddit}`);

// Serve
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const requestedSubreddit = url.searchParams.get("subreddit") || initialSubreddit;
  const subreddit = communities.includes(requestedSubreddit) ? requestedSubreddit : initialSubreddit;
  const reports = loadReports(subreddit);
  const periodFallback = false;
  const selectedPeriod = "all";
  const reportToServe = reports.all;
  if (!reportToServe) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No report available for this subreddit.");
    return;
  }
  refreshHighSignalExport(subreddit, reports.all || reportToServe);
  const periodHtml = renderResearchStudio({ report: reportToServe, selectedPeriod, subreddit, availableCommunities: communities, periodFallback, periodCapabilities: Object.fromEntries(Object.entries(reports).map(([key, value]) => [key, Boolean(value?.topicBreakdown?.matrix?.length)])) });
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(periodHtml);
});
server.listen(PORT, () => {
  console.log(`\n  Reddit Memory UI at http://localhost:${PORT}\n`);
  console.log(`  Communities: ${communities.length} · Periods: ${PERIODS.map(p => p.key).join(", ")}\n`);
});
