/**
 * Reddit Memory UI — dashboard with rich charts and interactive visualizations.
 *
 * Usage: node scripts/reddit-memory-ui.mjs <subreddit>
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";

const SUBREDDIT = process.argv[2] || "LocalLLaMA";
const PORT = parseInt(process.env.PORT || "7424", 10);

const PERIODS = [
  { key: "all", label: "All time", days: null },
  { key: "365d", label: "Last year", days: 365 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "7d", label: "Last 7 days", days: 7 },
];

function loadReport(days) {
  const suffix = days ? `-${days}d` : "";
  const file = join(process.cwd(), "data", "reddit-memory", `${SUBREDDIT}-report${suffix}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

// Load all reports so we can generate one HTML per period
const reports = {};
for (const p of PERIODS) {
  const r = loadReport(p.days);
  if (r) {
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
  }
  reports[p.key] = r;
}

if (!reports.all) {
  console.error(`No report found. Run analyze first.`);
  process.exit(1);
}

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
  return `<title>${esc(text)}</title>`;
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

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px;overflow:visible">`;

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

  const title = useBars ? "Topic Stacked Bars" : "Topic Streamgraph";
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

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px;max-width:100%;overflow:visible">`;

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
  return `<div class="chart-card"><div class="chart-card-title">Activity Heatmap</div><div class="chart-card-sub">When posts are submitted (UTC). Darker = more posts. Hover for exact counts.</div><div class="chart-scroll">${svg}</div></div>`;
}

// ─── 3. Top Posts Leaderboard ─────────────────────────────────────────────

function renderTopPosts(posts, title, sortBy) {
  if (!posts || posts.length === 0) return "";
  let table = `<div class="chart-scroll"><table class="data-table"><thead><tr>
    <th>#</th><th>Title</th><th>Score</th><th>Comments</th><th>Upvote%</th><th>Flair</th><th>Author</th><th>Date</th>
  </tr></thead><tbody>`;
  posts.forEach((p, i) => {
    table += `<tr>
      <td>${i + 1}</td>
      <td style="max-width:350px">${esc(p.title)}</td>
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

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:auto">`;

  contributors.forEach((c, i) => {
    const y = padT + i * (barH + gap);
    const w = (c.posts / maxPosts) * (W - padL - padR);
    svg += `<text x="${padL - 8}" y="${y + barH / 2 + 4}" text-anchor="end" fill="#e5e5e5" font-size="11" font-weight="500">${esc(c.author)}</text>`;
    svg += `<rect x="${padL}" y="${y}" width="${w}" height="${barH}" rx="3" fill="#22d3ee" opacity="0.7" ${tooltip(`${c.author}: ${c.posts} posts, avg score ${c.avgScore}, ${c.totalComments} total comments`)}/>`;
    svg += `<text x="${padL + w + 5}" y="${y + barH / 2 + 4}" fill="#737373" font-size="10">${c.posts} posts · avg ${c.avgScore}</text>`;
  });

  svg += "</svg>";
  return `<div class="chart-card"><div class="chart-card-title">Top Contributors</div><div class="chart-card-sub">Most active posters with average post score</div><div class="chart-scroll">${svg}</div></div>`;
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

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px;overflow:visible">`;

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

  const title = useBars ? "Tone Stacked Bars" : "Tone Trajectory";
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

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px;overflow:visible">`;
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
  const legend = `<div class="chart-legend"><div class="legend-item"><div class="legend-dot" style="background:#22d3ee"></div>Posts</div><div class="legend-item"><div class="legend-dot" style="background:#a78bfa"></div>Comments (scaled)</div></div>`;

  return `<div class="chart-card"><div class="chart-card-title">Post & Comment Volume</div><div class="chart-card-sub">Post and comment counts per time bucket</div>${scaleNote}<div class="chart-scroll time-series-scroll">${svg}</div>${legend}</div>`;
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

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:auto">`;

  bars.forEach((b, i) => {
    const y = padT + i * (barH + gap);
    const w = (b.pct / maxPct) * (W - padL - padR);
    svg += `<text x="${padL - 8}" y="${y + barH / 2 + 4}" text-anchor="end" fill="#e5e5e5" font-size="11">${b.label}</text>`;
    svg += `<rect x="${padL}" y="${y}" width="${w}" height="${barH}" rx="4" fill="${b.color}" opacity="0.75" ${tooltip(`${b.label}: ${b.count} posts (${b.pct.toFixed(1)}%)`)}/>`;
    svg += `<text x="${padL + w + 6}" y="${y + barH / 2 + 4}" fill="#737373" font-size="10">${b.count} (${b.pct.toFixed(1)}%)</text>`;
  });

  svg += "</svg>";
  return `<div class="chart-card"><div class="chart-card-title">Moderation Summary</div><div class="chart-card-sub">Breakdown of moderation signals across all posts</div><div class="chart-scroll">${svg}</div></div>`;
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

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">`;

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
    const topicLabel = typeof d.topic === "object" ? d.topic.topic : (report.topics[d.topic]?.label || "Unknown");
    const color = topicColorMap[topicLabel] || "#737373";
    const r = Math.max(2, Math.min(8, Math.sqrt(d.score + 1) / 8));
    const tip = `${esc(d.title)}\nScore: ${d.score} | Comments: ${d.comments} | Upvote: ${(d.upvoteRatio * 100).toFixed(0)}% | ${esc(d.flair)}`;
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="0.6" ${tooltip(tip)}/>`;
  }

  svg += "</svg>";
  const legend = `<div class="chart-legend">${(reportRef?.topics || []).slice(0, 6).map((t, i) => `<div class="legend-item"><div class="legend-dot" style="background:${TOPIC_COLORS[i % TOPIC_COLORS.length]}"></div>${esc(t.label)}</div>`).join("")}</div>`;

  return `<div class="chart-card"><div class="chart-card-title">Engagement Scatter</div><div class="chart-card-sub">Post score vs comment count (log-log). Dot size = score. Hover for details. Color = topic.</div><div class="chart-scroll">${svg}</div>${legend}</div>`;
}

// ─── 9. Flair Donut Chart ─────────────────────────────────────────────────

function renderFlairDonut(moderation) {
  if (!moderation?.flairDist) return "";
  const flairs = moderation.flairDist.slice(0, 10);
  const total = flairs.reduce((s, [, c]) => s + c, 0);
  const W = 400, H = 280, cx = 130, cy = 130, r = 90, rInner = 50;

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:400px;height:auto">`;
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

  return `<div class="chart-card"><div class="chart-card-title">Post Flair Distribution</div><div class="chart-card-sub">How posts are categorized</div><div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">${svg}${legend}</div></div>`;
}

// ─── 10. Score Distribution Histogram (log bins) ──────────────────────────

function renderScoreHistogram(histogram) {
  if (!histogram || histogram.length < 1) return "";
  const W = 700, H = 220, padL = 55, padR = 20, padT = 20, padB = 50;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const maxCount = Math.max(...histogram.map(h => h.count), 1);
  const barW = chartW / histogram.length;

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">`;
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

  return `<div class="chart-card"><div class="chart-card-title">Score Distribution</div><div class="chart-card-sub">Posts grouped by score range (log bins to handle power-law distribution)</div><div class="chart-scroll">${svg}</div></div>`;
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
          <div class="pm-label">Comments</div>
          <div class="pm-value">${fmtCompact(r.comments)}</div>
          <div class="pm-delta">${deltaArrow(d.comments)} <span class="pm-pct">${pctDelta(r.comments, p.comments)}</span></div>
        </div>
        <div class="period-metric">
          <div class="pm-label">Avg score</div>
          <div class="pm-value">${r.avgScore.toFixed(2)}</div>
          <div class="pm-delta">${deltaArrow(d.avgScore)}</div>
        </div>
        <div class="period-metric">
          <div class="pm-label">Avg comments/post</div>
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
  const W = chartWidth(data.length), H = 260, padL = 50, padR = 20, padT = 20, padB = 70;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const maxPosts = Math.max(...data.map(w => w.posts), 1);
  const xStep = data.length > 1 ? chartW / (data.length - 1) : 0;
  const stride = Math.max(1, Math.ceil(data.length / 12));

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px;overflow:visible">`;
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

  return `<div class="chart-card"><div class="chart-card-title">Weekly Metrics</div><div class="chart-card-sub">Posts per week (bars) and average score (line) — last 26 weeks</div><div class="chart-scroll time-series-scroll">${svg}</div>${legend}</div>`;
}

// ─── Last 7 Days Daily Breakdown ──────────────────────────────────────────

function renderDailyBreakdown(daily) {
  if (!daily || daily.length === 0) return "";
  const W = 600, H = 280, padL = 50, padR = 20, padT = 30, padB = 50;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const maxPosts = Math.max(...daily.map(d => d.posts), 1);
  const maxComments = Math.max(...daily.map(d => d.comments), 1);
  const groupW = chartW / daily.length;
  const barW = Math.min(30, groupW * 0.3);

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px;overflow:visible">`;
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
  const legend = `<div class="chart-legend"><div class="legend-item"><div class="legend-dot" style="background:#22d3ee"></div>Posts</div><div class="legend-item"><div class="legend-dot" style="background:#a78bfa"></div>Comments</div></div>`;

  return `<div class="chart-card"><div class="chart-card-title">Last 7 Days</div><div class="chart-card-sub">Daily post and comment counts for the past week</div><div class="chart-scroll time-series-scroll">${svg}</div>${legend}</div>`;
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

// ─── HTML generator ───────────────────────────────────────────────────────

function renderDashboard(report, selectedPeriod = "all") {
  const periodOptions = PERIODS.map(p => `<option value="${p.key}" ${p.key === selectedPeriod ? "selected" : ""}>${p.label}</option>`).join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reddit Memory — r/${esc(SUBREDDIT)}</title>
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
</style></head><body>

<div class="header">
  <h1>Reddit Memory <span class="accent">r/${esc(SUBREDDIT)}</span></h1>
  <div class="subtitle">${fmtCompact(report.totals.posts)} posts · ${fmtCompact(report.totals.comments)} comments · ${fmtCompact(report.totals.texts)} texts analyzed · ${report.totals.dateRange.start} → ${report.totals.dateRange.end} · generated ${new Date(report.generatedAt).toLocaleString()}</div>
</div>

${selectedPeriod === "all" && report.totals.posts > 0
  ? `<div class="coverage-note" style="margin-bottom:1rem">All-time view: this subreddit grew rapidly, so older months are sparse. Switch to <a href="?period=365d">Last year</a> or <a href="?period=90d">Last 90 days</a> for denser trend charts.</div>`
  : ""}
<div class="period-selector">
  <label for="period-select">Dashboard period:</label>
  <select id="period-select" onchange="window.location.href='?period='+this.value">
    ${periodOptions}
  </select>
  <span class="sub" style="font-size:0.8rem">Select a period to filter all charts and metrics.</span>
</div>

<div class="summary-grid">
  <div class="summary-card"><div class="label">Posts</div><div class="value">${report.totals.posts}</div><div class="sub-label">across ${report.evolution?.totalMonths || report.evolution?.months?.length || 1} months</div></div>
  <div class="summary-card"><div class="label">Comments</div><div class="value">${report.totals.comments}</div><div class="sub-label">${(report.totals.comments / report.totals.posts).toFixed(1)} per post</div></div>
  <div class="summary-card"><div class="label">Answer Rate</div><div class="value ${report.health.answerRate > 70 ? "good" : "warn"}">${report.health.answerRate.toFixed(1)}%</div><div class="sub-label">${report.health.postsWithComments}/${report.health.totalPosts} posts answered</div></div>
  <div class="summary-card"><div class="label">Mod Score</div><div class="value ${report.moderation?.modScore > 80 ? "good" : "warn"}">${report.moderation?.modScore || "—"}/100</div><div class="sub-label">${report.moderation?.flagged || 0} flagged · ${report.moderation?.lockedPosts || 0} locked</div></div>
  <div class="summary-card"><div class="label">Recurring Qs</div><div class="value">${report.recurringQuestions.length}</div><div class="sub-label">semantic question groups</div></div>
  <div class="summary-card"><div class="label">Topics</div><div class="value">${report.topics.length}</div><div class="sub-label">anchor-based clusters</div></div>
  <div class="summary-card"><div class="label">Tone</div><div class="value">${pct(report.tone.posts.pos, report.tone.posts.total).replace("%","")}% <span style="color:var(--pos)">+</span></div><div class="sub-label">${pct(report.tone.posts.neg, report.tone.posts.total).replace("%","")}% <span style="color:var(--neg)">−</span></div></div>
  <div class="summary-card"><div class="label">Median Score</div><div class="value">${report.health.medianScore}</div><div class="sub-label">upvotes per post</div></div>
</div>

<!-- ─── Period Comparisons (7d/30d/365d) ─── -->
<div class="period-row">
${renderPeriodComparisons(report.periodComparisons)}
</div>

<!-- ─── Charts Row 0: Weekly + Daily ─── -->
<div class="chart-grid">
${renderWeeklyChart(report.weeklyData)}
${renderDailyBreakdown(report.dailyData)}
</div>

<!-- ─── Charts Row 1: Streamgraph + Tone ─── -->
<div class="chart-grid">
${renderTopicStreamgraph(report.topicBreakdownForChart)}
${renderToneChart(report.toneTrajectoryForChart)}
</div>

<!-- ─── Charts Row 2: Volume + Activity Heatmap ─── -->
<div class="chart-grid">
${renderVolumeChart(report.toneTrajectoryForChart)}
${renderActivityHeatmap(report.activityGrid)}
</div>

<!-- ─── Charts Row 3: Engagement + Flair ─── -->
<div class="chart-grid">
${renderEngagementScatter(report.engagementScatter, report)}
${renderFlairDonut(report.moderation)}
</div>

<!-- ─── Charts Row 4: Moderation Summary + Score Histogram ─── -->
<div class="chart-grid">
${renderModerationSummary(report.moderation)}
${renderScoreHistogram(report.scoreHistogram)}
</div>

<!-- ─── Charts Row 5: Top Contributors ─── -->
<div class="chart-grid">
${renderTopContributors(report.topContributors)}
</div>

<!-- ─── Top Posts Leaderboard ─── -->
<details open><summary>Top Posts <span class="badge badge-info">${report.topPosts?.length || 0} posts</span></summary><div class="section-content">
${renderTopPosts(report.topPosts, "Top Posts by Score", "score")}
</div></details>

<details><summary>Most Commented Posts <span class="badge badge-info">${report.mostCommented?.length || 0} posts</span></summary><div class="section-content">
${renderTopPosts(report.mostCommented, "Most Commented Posts", "comment count")}
</div></details>

<!-- ─── Topic Distribution Table ─── -->
<details><summary>Topic Distribution Table</summary><div class="section-content">
${renderTopicTable(report.topicBreakdown)}
</div></details>

<!-- ─── Recurring Questions ─── -->
<details><summary>Recurring Questions <span class="badge ${report.recurringQuestions.length > 0 ? "badge-ok" : "badge-no"}">${report.recurringQuestions.length} groups</span></summary><div class="section-content">
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
<details><summary>Topic Clusters <span class="badge badge-info">${report.topics.length} topics</span></summary><div class="section-content">
<p class="sub" style="margin-bottom:0.75rem">
  Each of the ${report.totals.texts} texts (post titles + bodies + comment bodies) is assigned to the nearest topic by embedding similarity.
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
<details><summary>Tone & Emotion</summary><div class="section-content">
<div class="card">
  <div class="tone-comparison">
    <div class="tone-col">
      <h3>Posts (${report.tone.posts.total})</h3>
      ${renderToneBar(report.tone.posts)}
      ${renderEmotions(report.tone.posts.emotions)}
    </div>
    <div class="tone-col">
      <h3>Comments (${report.tone.comments.total})</h3>
      ${renderToneBar(report.tone.comments)}
      ${renderEmotions(report.tone.comments.emotions)}
    </div>
  </div>
</div>
</div></details>

<!-- ─── Comment Groups ─── -->
<details><summary>Answer Groups per Question <span class="badge badge-info">${report.questionGroups.length} questions</span></summary><div class="section-content">
${report.questionGroups.map(qg => `
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
  </div>`).join("")}
</div></details>

<!-- ─── Evolution ─── -->
<details><summary>Evolution (Community Phases)${report.evolution?.phases ? ` <span class="badge badge-info">${report.evolution.phases.length} phases</span>` : ""}</summary><div class="section-content">
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
    <div class="health-cell"><div class="label">Avg comments/post</div><div class="value">${report.health.avgCommentsPerPost.toFixed(1)}</div></div>
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
<details><summary>Moderation${report.moderation ? ` <span class="badge ${report.moderation.modScore > 80 ? "badge-ok" : "badge-no"}">${report.moderation.modScore}/100</span>` : ""}</summary><div class="section-content">
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
      <thead><tr><th>Title</th><th>Score</th><th>Comments</th><th>Upvote %</th><th>Flair</th></tr></thead>
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

<script>
  // Scroll time-series chart containers to the right end by default so the most recent data is visible
  document.querySelectorAll('.time-series-scroll').forEach(el => { el.scrollLeft = el.scrollWidth; });
</script>
</body></html>`;
}

const html = renderDashboard(reports.all, "all");

// Save static HTML files for each period
const htmlFile = join(process.cwd(), "data", "reddit-memory", `${SUBREDDIT}-report.html`);
if (!existsSync(dirname(htmlFile))) mkdirSync(dirname(htmlFile), { recursive: true });
writeFileSync(htmlFile, html);
console.log(`  Static HTML saved to ${htmlFile}`);

// Serve
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const period = url.searchParams.get("period") || "all";
  const reportToServe = reports[period] || reports.all;
  const periodHtml = renderDashboard(reportToServe, period);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(periodHtml);
});
server.listen(PORT, () => {
  console.log(`\n  Reddit Memory UI at http://localhost:${PORT}\n`);
  console.log(`  Periods: ${PERIODS.map(p => `?period=${p.key}`).join(", ")}\n`);
});
