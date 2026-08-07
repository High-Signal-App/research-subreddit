/**
 * Pre-caches RSS data for a subreddit and serves the UI with the data
 * embedded directly — no live Reddit calls needed.
 *
 * Usage: node scripts/reddit-experiment-cached.mjs <subreddit>
 */

import { createServer } from "node:http";

const SUBREDDIT = process.argv[2] || "LocalLLaMA";
const PORT = 7422;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── Fetch all RSS feeds ──────────────────────────────────────────────────

async function fetchRss(sort) {
  let path;
  if (sort === "top") path = `/r/${encodeURIComponent(SUBREDDIT)}/top/.rss?t=month`;
  else if (sort === "new") path = `/r/${encodeURIComponent(SUBREDDIT)}/new/.rss`;
  else path = `/r/${encodeURIComponent(SUBREDDIT)}/.rss`;

  const url = `https://www.reddit.com${path}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (res.status === 429) {
      const reset = parseInt(res.headers.get("x-ratelimit-reset") || "30", 10);
      console.log(`  429, waiting ${reset + 5}s (attempt ${attempt + 1}/4)...`);
      await sleep((reset + 5) * 1000);
      continue;
    }
    if (res.status === 403) {
      // Try again after a wait
      console.log(`  403, waiting 35s (attempt ${attempt + 1}/4)...`);
      await sleep(35000);
      continue;
    }
    if (!res.ok) throw new Error(`reddit ${res.status}`);
    return await res.text();
  }
  throw new Error("rate-limited after 4 attempts");
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function parseAtomFeed(xml) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const published = extractTag(block, "published") || extractTag(block, "updated");
    const id = extractTag(block, "id");
    const author = extractTag(block, "name").replace("/u/", "");
    const link = extractAttr(block, "link", "href");
    const contentHtml = extractTagContent(block, "content");

    let selftext = "";
    const decoded = decodeHtml(contentHtml);
    const scMatch = decoded.match(/<!-- SC_OFF -->([\s\S]*?)<!-- SC_ON -->/);
    if (scMatch) selftext = stripHtml(scMatch[1]).trim();

    entries.push({
      id: id.replace("t3_", ""),
      title,
      selftext,
      author,
      created_utc: new Date(published).getTime() / 1000,
      permalink: link || "",
      score: 0,
      num_comments: 0,
    });
  }
  return entries;
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? decodeHtml(m[1].trim()) : "";
}
function extractTagContent(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1] : "";
}
function extractAttr(block, tag, attr) {
  const m = block.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`));
  return m ? m[1] : "";
}
function decodeHtml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#32;/g, " ");
}
function stripHtml(html) {
  return decodeHtml(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

// ─── Main: fetch data, then serve UI with embedded data ───────────────────

async function main() {
  console.log(`\n  Fetching RSS data for r/${SUBREDDIT}...\n`);

  // Fetch hot
  console.log(`  [1/3] hot feed...`);
  let posts = parseAtomFeed(await fetchRss("hot"));
  console.log(`    ${posts.length} posts`);

  await sleep(35000);
  console.log(`  [2/3] new feed...`);
  const newPosts = parseAtomFeed(await fetchRss("new"));
  console.log(`    ${newPosts.length} posts`);

  await sleep(35000);
  console.log(`  [3/3] top feed...`);
  const topPosts = parseAtomFeed(await fetchRss("top"));
  console.log(`    ${topPosts.length} posts`);

  // Deduplicate
  const seen = new Set(posts.map((p) => p.id));
  for (const p of newPosts) if (!seen.has(p.id)) { posts.push(p); seen.add(p.id); }
  for (const p of topPosts) if (!seen.has(p.id)) { posts.push(p); seen.add(p.id); }
  console.log(`\n  ${posts.length} unique posts total\n`);

  // Embed posts as JSON in the HTML
  const postsJson = JSON.stringify(posts);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reddit Memory Experiment — r/${SUBREDDIT}</title>
<style>
  :root {
    --bg: #0a0a0a; --surface: #141414; --border: #262626;
    --text: #e5e5e5; --dim: #737373; --accent: #22d3ee;
    --pos: #4ade80; --neg: #f87171; --neu: #a3a3a3;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    background: var(--bg); color: var(--text);
    line-height: 1.6; padding: 2rem; max-width: 900px; margin: 0 auto;
  }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; font-weight: 600; margin: 2rem 0 0.75rem; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
  .sub { color: var(--dim); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .progress { margin: 1rem 0; padding: 0.75rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; font-size: 0.85rem; color: var(--dim); }
  .progress .bar { height: 3px; background: var(--border); border-radius: 2px; margin-top: 0.5rem; overflow: hidden; }
  .progress .bar-fill { height: 100%; background: var(--accent); transition: width 0.3s; width: 0%; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.2rem; margin-bottom: 0.75rem; }
  .repeat-group .rep { font-weight: 500; color: var(--text); }
  .repeat-group .meta { color: var(--dim); font-size: 0.8rem; }
  .repeat-group .examples { color: var(--dim); font-size: 0.8rem; margin-left: 1rem; margin-top: 0.25rem; }
  .topic-row { display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0; border-bottom: 1px solid var(--border); }
  .topic-row:last-child { border-bottom: none; }
  .topic-label { font-weight: 500; }
  .topic-count { color: var(--accent); font-variant-numeric: tabular-nums; font-size: 0.85rem; }
  .topic-examples { color: var(--dim); font-size: 0.78rem; margin-top: 0.2rem; }
  .tone-bar { display: flex; height: 24px; border-radius: 4px; overflow: hidden; margin: 0.5rem 0; }
  .tone-bar .seg { display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 600; }
  .tone-bar .pos { background: var(--pos); color: #000; }
  .tone-bar .neu { background: #333; color: #fff; }
  .tone-bar .neg { background: var(--neg); color: #fff; }
  .emotion-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.5rem; margin-top: 0.5rem; }
  .emotion-cell { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 0.5rem; }
  .emotion-cell .name { font-size: 0.8rem; color: var(--dim); }
  .emotion-cell .val { font-size: 1.1rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .evolution-month .month-label { font-weight: 500; color: var(--accent); }
  .evolution-month .titles { color: var(--dim); font-size: 0.8rem; margin-left: 1rem; }
  .drift-row { display: flex; justify-content: space-between; padding: 0.3rem 0; font-size: 0.85rem; border-bottom: 1px solid var(--border); }
  .drift-row:last-child { border-bottom: none; }
  .totals-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 0.5rem; margin-bottom: 0.5rem; }
  .total-cell { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 0.6rem; }
  .total-cell .label { font-size: 0.75rem; color: var(--dim); }
  .total-cell .value { font-size: 1.3rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .badge-ok { background: #0d3320; color: var(--pos); }
  .badge-no { background: #3d1212; color: var(--neg); }
</style>
</head>
<body>

<h1>Reddit Memory Experiment — r/${SUBREDDIT}</h1>
<p class="sub">Pre-cached RSS data (${posts.length} posts). Running embedding engine in browser...</p>

<div class="progress" id="progress">
  <div id="progress-text">Starting...</div>
  <div class="bar"><div class="bar-fill" id="bar-fill"></div></div>
</div>

<div id="results"></div>

<script type="module">
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const POSTS = ${postsJson};

function showProgress(text, pct) {
  document.getElementById("progress-text").textContent = text;
  if (pct !== undefined) document.getElementById("bar-fill").style.width = pct + "%";
}

function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function pct(n, t) { return t > 0 ? ((n / t) * 100).toFixed(1) + "%" : "0%"; }

// ─── Map posts to records ─────────────────────────────────────────────────
function mapToRecords(posts) {
  return posts.map(post => {
    const date = (post.created_utc ?? 0) * 1000;
    const prompts = [];
    if (post.title) prompts.push({ id: post.id + "-t", text: post.title, date });
    if (post.selftext && post.selftext.length > 20) prompts.push({ id: post.id + "-b", text: post.selftext.slice(0, 2000), date });
    return { id: post.id, title: post.title, date, prompts };
  });
}

// ─── Embedding ────────────────────────────────────────────────────────────
let extractor = null;
async function embedTexts(texts, label) {
  if (!extractor) {
    showProgress("Loading embedding model (all-MiniLM-L6-v2, ~24MB)...", 5);
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
  }
  const embeddings = [];
  const BATCH = 16;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    for (let j = 0; j < batch.length; j++) embeddings.push(Float32Array.from(output[j].data));
    showProgress("Embedding " + label + ": " + Math.min(i + BATCH, texts.length) + "/" + texts.length, 20 + Math.round((i / texts.length) * 50));
  }
  return embeddings;
}

function cosineSim(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; }

// ─── Analysis ─────────────────────────────────────────────────────────────
function findRepeats(texts, embeddings, threshold = 0.72) {
  const groups = [], used = new Set();
  for (let i = 0; i < texts.length; i++) {
    if (used.has(i)) continue;
    const cluster = [i]; used.add(i);
    for (let j = i + 1; j < texts.length; j++) {
      if (used.has(j)) continue;
      if (cosineSim(embeddings[i], embeddings[j]) >= threshold) { cluster.push(j); used.add(j); }
    }
    if (cluster.length >= 2) {
      groups.push({
        representative: texts[i].slice(0, 150),
        count: cluster.length,
        avgSim: cluster.reduce((s, idx) => idx === i ? s : s + cosineSim(embeddings[i], embeddings[idx]), 0) / (cluster.length - 1),
        texts: cluster.map(idx => texts[idx].slice(0, 120)),
      });
    }
  }
  return groups.sort((a, b) => b.count - a.count);
}

const TOPIC_ANCHORS = [
  ["Local LLM setup", "local llm running setup hardware gpu cpu inference ollama llama.cpp vllm server deploy"],
  ["Model comparison", "model comparison benchmark performance speed quality gpt llama mistral qwen gemma deepseek"],
  ["Fine-tuning & training", "fine-tuning training lora qlora dataset adapter custom model sft"],
  ["Quantization", "quantization gguf ggml q4 q8 int4 int8 compression size memory bits"],
  ["Agents & tools", "agent tools function calling mcp autonomous workflow automation tool use"],
  ["RAG & retrieval", "rag retrieval vector database embedding search context documents knowledge"],
  ["Hardware & GPU", "gpu vram ram nvidia amd apple silicon mac rtx requirements memory bandwidth"],
  ["Prompting & UX", "prompting chat interface ui ux system prompt template conversation"],
  ["Safety & alignment", "safety alignment censorship guardrails rlhf bias moderation filtering"],
  ["Coding & dev tools", "code coding programming development ide copilot debugger tools software"],
];

async function clusterTopics(texts, embeddings) {
  const anchorTexts = TOPIC_ANCHORS.map(([, t]) => t);
  const anchorEmbeds = await embedTexts(anchorTexts, "anchors");
  const assignments = embeddings.map(emb => {
    let best = 0, bestSim = -1;
    for (let a = 0; a < anchorEmbeds.length; a++) { const s = cosineSim(emb, anchorEmbeds[a]); if (s > bestSim) { bestSim = s; best = a; } }
    return { topicIdx: best, sim: bestSim };
  });
  return TOPIC_ANCHORS.map(([label], idx) => {
    const members = assignments.map((a, i) => ({ ...a, i })).filter(a => a.topicIdx === idx);
    return { label, count: members.length, avgSim: members.reduce((s, a) => s + a.sim, 0) / Math.max(1, members.length), examples: members.map(m => texts[m.i].slice(0, 100)).slice(0, 3) };
  }).filter(t => t.count > 0).sort((a, b) => b.count - a.count);
}

const POS_WORDS = new Set("awesome best better great good happy helpful love nice perfect progress proud useful win wonderful excited amazing".split(" "));
const NEG_WORDS = new Set("angry annoyed anxious awful bad broken confused difficult disappointed error fail failed failing frustrated hate hard horrible issue problem sad stuck terrible useless worse worst wrong".split(" "));
const EMOTION_PATTERNS = {
  curiosity: [/\\b(?:why|how|what|wonder|curious|explain|understand|learn|explore|discover)\\b/i],
  frustration: [/\\b(?:stuck|broken|fail(?:ed|ing)?|error|annoyed|frustrat(?:ed|ing)|hate|wrong|useless|doesn'?t work|not working)\\b/i],
  urgency: [/\\b(?:urgent|asap|quickly|right now|immediately|deadline|hurry)\\b/i],
  uncertainty: [/\\b(?:unsure|maybe|might|could|perhaps|confused|not sure|uncertain)\\b/i],
  excitement: [/\\b(?:excited|amazing|awesome|love|can'?t wait|great|wonderful|super)\\b/i],
  appreciation: [/\\b(?:thanks|thank you|appreciate|helpful|grateful)\\b/i],
};

function analyzeTone(texts) {
  let pos = 0, neu = 0, neg = 0;
  const emotions = { curiosity: 0, frustration: 0, urgency: 0, uncertainty: 0, excitement: 0, appreciation: 0, neutral: 0 };
  for (const text of texts) {
    const words = text.toLowerCase().split(/\\s+/);
    let p = 0, n = 0;
    for (const w of words) { if (POS_WORDS.has(w)) p++; if (NEG_WORDS.has(w)) n++; }
    if (p > n) pos++; else if (n > p) neg++; else neu++;
    let found = false;
    for (const [e, pats] of Object.entries(EMOTION_PATTERNS)) { if (pats.some(p => p.test(text))) { emotions[e]++; found = true; break; } }
    if (!found) emotions.neutral++;
  }
  return { pos, neu, neg, emotions, total: texts.length };
}

function monthKey(ts) { const d = new Date(ts); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }

function analyzeEvolution(records, embeddings) {
  const byMonth = new Map();
  records.forEach((rec, i) => { const mk = monthKey(rec.date); if (!byMonth.has(mk)) byMonth.set(mk, []); byMonth.get(mk).push({ rec, emb: embeddings[i] }); });
  const months = [...byMonth.keys()].sort();
  if (months.length < 2) return { months, note: "Need multiple months for evolution analysis" };
  const centroids = months.map(mk => { const items = byMonth.get(mk); const dim = items[0].emb.length; const c = new Float32Array(dim); for (const it of items) for (let d = 0; d < dim; d++) c[d] += it.emb[d]; for (let d = 0; d < dim; d++) c[d] /= items.length; return { month: mk, centroid: c, count: items.length }; });
  const drift = [];
  for (let i = 1; i < centroids.length; i++) { const sim = cosineSim(centroids[i-1].centroid, centroids[i].centroid); drift.push({ from: centroids[i-1].month, to: centroids[i].month, sim, drift: sim < 0.82 ? "significant" : sim < 0.90 ? "moderate" : "minimal" }); }
  const monthly = months.map(mk => { const items = byMonth.get(mk); return { month: mk, count: items.length, titles: items.map(it => it.rec.title.slice(0, 70)).slice(0, 5) }; });
  return { months, drift, monthly };
}

// ─── Render ───────────────────────────────────────────────────────────────
function renderResults(data) {
  const { records, repeats, topics, tone, evolution, totals, embedMs } = data;
  let html = "";

  html += "<h2>Totals</h2>";
  html += "<div class='totals-grid'>";
  html += "<div class='total-cell'><div class='label'>Posts</div><div class='value'>" + totals.posts + "</div></div>";
  html += "<div class='total-cell'><div class='label'>Texts</div><div class='value'>" + totals.texts + "</div></div>";
  html += "<div class='total-cell'><div class='label'>Embed time</div><div class='value'>" + (embedMs/1000).toFixed(1) + "s</div></div>";
  html += "</div>";
  html += "<p class='sub'>Date range: " + new Date(totals.dateStart).toISOString().slice(0,10) + " → " + new Date(totals.dateEnd).toISOString().slice(0,10) + "</p>";

  html += "<h2>Recurring Questions / Themes <span class='badge " + (repeats.length > 0 ? "badge-ok" : "badge-no") + "'>" + repeats.length + " groups</span></h2>";
  if (repeats.length === 0) html += "<p class='sub'>No semantic repeats found at threshold 0.72.</p>";
  else for (const g of repeats.slice(0, 12)) {
    html += "<div class='card repeat-group'>";
    html += "<div class='rep'>" + esc(g.representative) + "</div>";
    html += "<div class='meta'>" + g.count + "x, avg similarity " + g.avgSim.toFixed(3) + "</div>";
    html += "<div class='examples'>";
    for (const t of g.texts.slice(0, 3)) html += "→ " + esc(t) + "<br>";
    html += "</div></div>";
  }

  html += "<h2>Topic Clusters</h2>";
  for (const t of topics) {
    html += "<div class='card'>";
    html += "<div class='topic-row'><span class='topic-label'>" + esc(t.label) + "</span><span class='topic-count'>" + t.count + " texts</span></div>";
    html += "<div class='topic-examples'>";
    for (const ex of t.examples) html += "→ " + esc(ex) + "<br>";
    html += "</div></div>";
  }

  html += "<h2>Tone & Emotion</h2>";
  html += "<div class='card'>";
  const tp = tone.total || 1;
  html += "<div class='tone-bar'>";
  html += "<div class='seg pos' style='width:" + (tone.pos/tp*100) + "%'>" + (tone.pos > 0 ? pct(tone.pos, tone.total) : "") + "</div>";
  html += "<div class='seg neu' style='width:" + (tone.neu/tp*100) + "%'>" + (tone.neu > 0 ? pct(tone.neu, tone.total) : "") + "</div>";
  html += "<div class='seg neg' style='width:" + (tone.neg/tp*100) + "%'>" + (tone.neg > 0 ? pct(tone.neg, tone.total) : "") + "</div>";
  html += "</div>";
  html += "<div class='emotion-grid'>";
  for (const [e, c] of Object.entries(tone.emotions).sort((a,b) => b[1]-a[1])) {
    html += "<div class='emotion-cell'><div class='name'>" + e + "</div><div class='value'>" + c + "</div></div>";
  }
  html += "</div></div>";

  html += "<h2>Evolution</h2>";
  if (evolution.note) html += "<p class='sub'>" + evolution.note + "</p>";
  else {
    html += "<div class='card'>";
    for (const m of evolution.monthly) {
      html += "<div class='evolution-month'><div class='month-label'>" + m.month + " (" + m.count + " posts)</div>";
      html += "<div class='titles'>";
      for (const t of m.titles) html += "→ " + esc(t) + "<br>";
      html += "</div></div>";
    }
    html += "<div style='margin-top:0.75rem'><strong>Centroid drift:</strong></div>";
    for (const d of evolution.drift) {
      html += "<div class='drift-row'><span>" + d.from + " → " + d.to + "</span><span>sim=" + d.sim.toFixed(3) + " (" + d.drift + ")</span></div>";
    }
    html += "</div>";
  }

  document.getElementById("results").innerHTML = html;
  document.getElementById("progress").style.display = "none";
}

// ─── Run ──────────────────────────────────────────────────────────────────
async function run() {
  showProgress("Mapping " + POSTS.length + " posts...", 10);
  const records = mapToRecords(POSTS);
  const allPrompts = records.flatMap(r => r.prompts);
  const allTexts = allPrompts.map(p => p.text);
  showProgress("Embedding " + allTexts.length + " texts...", 20);

  const t0 = performance.now();
  const embeddings = await embedTexts(allTexts, "texts");
  const embedMs = performance.now() - t0;

  showProgress("Finding recurring questions...", 70);
  const repeats = findRepeats(allTexts, embeddings, 0.72);

  showProgress("Clustering topics...", 75);
  const topics = await clusterTopics(allTexts, embeddings);

  showProgress("Analyzing tone...", 80);
  const tone = analyzeTone(allTexts);

  showProgress("Analyzing evolution...", 85);
  const postTitles = records.map(r => r.title);
  const postEmbeds = await embedTexts(postTitles, "titles");
  const evolution = analyzeEvolution(records, postEmbeds);

  showProgress("Done!", 100);
  renderResults({
    records, repeats, topics, tone, evolution,
    totals: { posts: POSTS.length, texts: allTexts.length, dateStart: Math.min(...records.map(r => r.date)), dateEnd: Math.max(...records.map(r => r.date)) },
    embedMs,
  });
}

run().catch(err => {
  document.getElementById("progress-text").textContent = "Error: " + err.message;
  console.error(err);
});
</script>
</body>
</html>`;

  // Save HTML to file
  const fs = await import("node:fs");
  fs.writeFileSync("/tmp/reddit-experiment-cached.html", html);
  console.log(`  HTML saved to /tmp/reddit-experiment-cached.html`);

  // Serve it
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  server.listen(PORT, () => {
    console.log(`\n  Cached UI running at http://localhost:${PORT}`);
    console.log(`  Open this URL in your browser to see the results.\n`);
  });
}

main().catch((err) => { console.error("Failed:", err.message); process.exit(1); });
