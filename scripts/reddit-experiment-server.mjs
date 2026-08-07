/**
 * Reddit Memory Experiment — local UI server
 *
 * Starts a local server that:
 *   1. Serves a web UI at http://localhost:7421
 *   2. Proxies Reddit JSON requests server-side (avoids CORS + 403)
 *
 * The browser loads Transformers.js, runs embeddings + clustering + tone
 * analysis, and renders the results — same engine architecture as the main
 * product.
 *
 * Usage: node scripts/reddit-experiment-server.mjs
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 7421;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── Reddit proxy ─────────────────────────────────────────────────────────
// Reddit's .json endpoints return 403 from residential IPs. RSS works.
// We proxy RSS feeds server-side and parse them into post objects.
// Comments require .json (blocked) or OAuth — not available in local mode.

async function proxyRedditRss(path) {
  const url = `https://www.reddit.com${path}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (res.status === 429) {
      const reset = parseInt(res.headers.get("x-ratelimit-reset") || "30", 10);
      return { status: 429, error: "rate_limited", resetIn: reset + 2 };
    }
    if (res.status === 403) {
      return { status: 403, error: "forbidden" };
    }
    if (!res.ok) {
      return { status: res.status, error: `reddit_${res.status}` };
    }
    const xml = await res.text();
    return { status: 200, xml };
  }
  return { status: 429, error: "rate_limited_after_retries" };
}

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

    // Extract selftext (between SC_OFF/SC_ON markers, HTML-encoded in RSS)
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
      score: 0, // RSS doesn't include score
      num_comments: 0, // RSS doesn't include comment count
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

// ─── HTTP server ──────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS headers for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: proxy Reddit RSS → parsed posts JSON
  if (url.pathname.startsWith("/api/reddit/")) {
    const redditPath = url.pathname.replace("/api/reddit", "") + url.search;
    const result = await proxyRedditRss(redditPath);
    if (result.status === 200) {
      const posts = parseAtomFeed(result.xml);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ posts }));
    } else {
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: result.error, resetIn: result.resetIn }));
    }
    return;
  }

  // Serve the UI
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(UI_HTML);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n  Reddit Memory Experiment UI`);
  console.log(`  → http://localhost:${PORT}\n`);
  console.log(`  Enter a subreddit name and click Analyze.`);
  console.log(`  The browser will fetch posts + comments via the proxy`);
  console.log(`  and run the embedding engine locally.\n`);
});

// ─── UI HTML ──────────────────────────────────────────────────────────────

const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reddit Memory Experiment</title>
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
  .input-row { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
  input[type="text"] {
    flex: 1; min-width: 200px; padding: 0.6rem 0.8rem;
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); font-size: 0.95rem; outline: none;
  }
  input[type="text"]:focus { border-color: var(--accent); }
  select {
    padding: 0.6rem 0.8rem; background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; color: var(--text); font-size: 0.9rem; cursor: pointer;
  }
  button {
    padding: 0.6rem 1.4rem; background: var(--accent); color: #000; border: none;
    border-radius: 6px; font-size: 0.9rem; font-weight: 600; cursor: pointer;
    transition: opacity 0.15s;
  }
  button:hover { opacity: 0.85; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .progress {
    margin: 1rem 0; padding: 0.75rem 1rem; background: var(--surface);
    border: 1px solid var(--border); border-radius: 6px; font-size: 0.85rem;
    color: var(--dim); display: none;
  }
  .progress.active { display: block; }
  .progress .bar {
    height: 3px; background: var(--border); border-radius: 2px; margin-top: 0.5rem; overflow: hidden;
  }
  .progress .bar-fill { height: 100%; background: var(--accent); transition: width 0.3s; width: 0%; }
  .error {
    margin: 1rem 0; padding: 0.75rem 1rem; background: #2a1212; border: 1px solid #5b1e1e;
    border-radius: 6px; color: var(--neg); font-size: 0.85rem; display: none;
  }
  .error.show { display: block; }
  .results { display: none; }
  .results.show { display: block; }
  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 1rem 1.2rem; margin-bottom: 0.75rem;
  }
  .repeat-group { margin-bottom: 0.5rem; }
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
  .evolution-month { margin-bottom: 0.5rem; }
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
  pre { white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>

<script>
// Auto-run if ?auto=1 is in the URL
window.addEventListener('load', () => {
  if (new URLSearchParams(location.search).get('auto') === '1') {
    setTimeout(() => analyze(), 1000);
  }
});
</script>
<h1>Reddit Memory Experiment</h1>
<p class="sub">Enter a subreddit — the browser fetches posts via a local RSS proxy and runs the embedding engine (all-MiniLM-L6-v2) to find recurring questions, topic clusters, tone, and evolution. <span style="color:var(--accent)">Note: comments require a Cloudflare Worker proxy (JSON is 403 from residential IPs) — not available in local mode yet.</span></p>

<div class="input-row">
  <input type="text" id="subreddit" placeholder="subreddit name (e.g. LocalLLaMA)" value="LocalLLaMA">
  <select id="sort">
    <option value="hot">hot</option>
    <option value="new">new</option>
    <option value="top">top (month)</option>
  </select>
  <input type="number" id="limit" value="25" min="5" max="100" style="width:70px" title="posts to fetch">
  <button id="analyze-btn" onclick="analyze()">Analyze</button>
</div>

<div class="error" id="error"></div>
<div class="progress" id="progress">
  <div id="progress-text">Starting...</div>
  <div class="bar"><div class="bar-fill" id="bar-fill"></div></div>
</div>

<div class="results" id="results"></div>

<script type="module">
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const PROXY = "/api/reddit";
let extractor = null;

function showProgress(text, pct) {
  const el = document.getElementById("progress");
  el.classList.add("active");
  document.getElementById("progress-text").textContent = text;
  if (pct !== undefined) {
    document.getElementById("bar-fill").style.width = pct + "%";
  }
}

function hideProgress() {
  document.getElementById("progress").classList.remove("active");
}

function showError(msg) {
  const el = document.getElementById("error");
  el.textContent = msg;
  el.classList.add("show");
}

function clearError() {
  document.getElementById("error").classList.remove("show");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Reddit fetching via proxy (RSS-based) ────────────────────────────────

async function fetchPosts(subreddit, sort) {
  let path;
  if (sort === "top") path = "/r/" + subreddit + "/top/.rss?t=month";
  else if (sort === "new") path = "/r/" + subreddit + "/new/.rss";
  else path = "/r/" + subreddit + "/.rss";

  const res = await fetch(PROXY + path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.resetIn) throw new Error("Reddit rate-limited. Wait " + body.resetIn + "s and try again.");
    if (body.error === "forbidden") throw new Error("Reddit returned 403. Try again in a minute.");
    throw new Error("Reddit error: " + (body.error || res.status));
  }
  const data = await res.json();
  return data.posts || [];
}

// ─── Data mapping ─────────────────────────────────────────────────────────

function mapToRecords(posts, commentsByPost) {
  return posts.map(post => {
    const date = (post.created_utc ?? 0) * 1000;
    const title = post.title ?? "";
    const selftext = post.selftext ?? "";
    const comments = commentsByPost[post.id] ?? [];

    const prompts = [];
    if (title) prompts.push({ id: post.id + "-t", text: title, date });
    if (selftext && selftext.length > 20) prompts.push({ id: post.id + "-b", text: selftext.slice(0, 2000), date });
    for (const c of comments) {
      prompts.push({ id: post.id + "-c-" + c.id, text: c.body.slice(0, 2000), date: (c.createdUtc || post.created_utc) * 1000 });
    }

    return {
      id: post.id, title, date,
      score: post.score ?? 0, numComments: post.num_comments ?? 0,
      author: post.author ?? "", permalink: post.permalink ?? "",
      prompts,
    };
  });
}

// ─── Embedding ────────────────────────────────────────────────────────────

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
    for (let j = 0; j < batch.length; j++) {
      embeddings.push(Float32Array.from(output[j].data));
    }
    const pct = Math.round((Math.min(i + BATCH, texts.length) / texts.length) * 100);
    showProgress("Embedding " + label + ": " + Math.min(i + BATCH, texts.length) + "/" + texts.length, 20 + pct * 0.5);
  }
  return embeddings;
}

function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// ─── Analysis ─────────────────────────────────────────────────────────────

function findRepeats(texts, embeddings, threshold = 0.72) {
  const groups = [];
  const used = new Set();
  for (let i = 0; i < texts.length; i++) {
    if (used.has(i)) continue;
    const cluster = [i];
    used.add(i);
    for (let j = i + 1; j < texts.length; j++) {
      if (used.has(j)) continue;
      if (cosineSim(embeddings[i], embeddings[j]) >= threshold) {
        cluster.push(j);
        used.add(j);
      }
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
    for (let a = 0; a < anchorEmbeds.length; a++) {
      const sim = cosineSim(emb, anchorEmbeds[a]);
      if (sim > bestSim) { bestSim = sim; best = a; }
    }
    return { topicIdx: best, sim: bestSim };
  });
  return TOPIC_ANCHORS.map(([label], idx) => {
    const members = assignments.map((a, i) => ({ ...a, i })).filter(a => a.topicIdx === idx);
    return {
      label, count: members.length,
      avgSim: members.reduce((s, a) => s + a.sim, 0) / Math.max(1, members.length),
      examples: members.map(m => texts[m.i].slice(0, 100)).slice(0, 3),
    };
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
    for (const [e, pats] of Object.entries(EMOTION_PATTERNS)) {
      if (pats.some(p => p.test(text))) { emotions[e]++; found = true; break; }
    }
    if (!found) emotions.neutral++;
  }
  return { pos, neu, neg, emotions, total: texts.length };
}

function monthKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function analyzeEvolution(records, embeddings) {
  const byMonth = new Map();
  records.forEach((rec, i) => {
    const mk = monthKey(rec.date);
    if (!byMonth.has(mk)) byMonth.set(mk, []);
    byMonth.get(mk).push({ rec, emb: embeddings[i] });
  });
  const months = [...byMonth.keys()].sort();
  if (months.length < 2) return { months, note: "Need multiple months for evolution analysis" };

  const centroids = months.map(mk => {
    const items = byMonth.get(mk);
    const dim = items[0].emb.length;
    const c = new Float32Array(dim);
    for (const item of items) for (let d = 0; d < dim; d++) c[d] += item.emb[d];
    for (let d = 0; d < dim; d++) c[d] /= items.length;
    return { month: mk, centroid: c, count: items.length };
  });

  const drift = [];
  for (let i = 1; i < centroids.length; i++) {
    const sim = cosineSim(centroids[i - 1].centroid, centroids[i].centroid);
    drift.push({
      from: centroids[i - 1].month, to: centroids[i].month,
      sim, drift: sim < 0.82 ? "significant" : sim < 0.90 ? "moderate" : "minimal",
    });
  }

  const monthly = months.map(mk => {
    const items = byMonth.get(mk);
    return { month: mk, count: items.length, titles: items.map(it => it.rec.title.slice(0, 70)).slice(0, 5) };
  });

  return { months, drift, monthly };
}

// ─── Rendering ────────────────────────────────────────────────────────────

function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function pct(n, t) { return t > 0 ? ((n / t) * 100).toFixed(1) + "%" : "0%"; }

function renderResults(data) {
  const { records, repeats, topics, tone, evolution, totals, embedMs } = data;
  const el = document.getElementById("results");
  let html = "";

  // Totals
  html += "<h2>Totals</h2>";
  html += "<div class='totals-grid'>";
  html += "<div class='total-cell'><div class='label'>Posts</div><div class='value'>" + totals.posts + "</div></div>";
  html += "<div class='total-cell'><div class='label'>Comments</div><div class='value'>" + totals.comments + "</div></div>";
  html += "<div class='total-cell'><div class='label'>Texts analyzed</div><div class='value'>" + totals.texts + "</div></div>";
  html += "<div class='total-cell'><div class='label'>Embed time</div><div class='value'>" + (embedMs / 1000).toFixed(1) + "s</div></div>";
  html += "</div>";
  html += "<p class='sub'>Date range: " + new Date(totals.dateStart).toISOString().slice(0,10) + " → " + new Date(totals.dateEnd).toISOString().slice(0,10) + "</p>";

  // Recurring questions
  html += "<h2>Recurring Questions / Themes <span class='badge " + (repeats.length > 0 ? "badge-ok" : "badge-no") + "'>" + repeats.length + " groups</span></h2>";
  if (repeats.length === 0) {
    html += "<p class='sub'>No semantic repeats found at threshold 0.72.</p>";
  } else {
    for (const g of repeats.slice(0, 12)) {
      html += "<div class='card repeat-group'>";
      html += "<div class='rep'>" + esc(g.representative) + "</div>";
      html += "<div class='meta'>" + g.count + "x, avg similarity " + g.avgSim.toFixed(3) + "</div>";
      html += "<div class='examples'>";
      for (const t of g.texts.slice(0, 3)) html += "→ " + esc(t) + "<br>";
      html += "</div></div>";
    }
  }

  // Topic clusters
  html += "<h2>Topic Clusters</h2>";
  for (const t of topics) {
    html += "<div class='card'>";
    html += "<div class='topic-row'><span class='topic-label'>" + esc(t.label) + "</span><span class='topic-count'>" + t.count + " texts</span></div>";
    html += "<div class='topic-examples'>";
    for (const ex of t.examples) html += "→ " + esc(ex) + "<br>";
    html += "</div></div>";
  }

  // Tone
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

  // Evolution
  html += "<h2>Evolution</h2>";
  if (evolution.note) {
    html += "<p class='sub'>" + evolution.note + "</p>";
  } else {
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

  el.innerHTML = html;
  el.classList.add("show");
}

// ─── Main ─────────────────────────────────────────────────────────────────

window.analyze = async function() {
  clearError();
  hideProgress();
  document.getElementById("results").classList.remove("show");
  document.getElementById("analyze-btn").disabled = true;

  const subreddit = document.getElementById("subreddit").value.trim().replace(/^r\\//, "");
  const sort = document.getElementById("sort").value;
  const limit = parseInt(document.getElementById("limit").value, 10) || 25;

  if (!subreddit) { showError("Enter a subreddit name."); return; }

  try {
    // 1. Fetch posts from multiple RSS feeds for more data
    showProgress("Fetching posts from r/" + subreddit + " (hot)...", 5);
    let posts = await fetchPosts(subreddit, "hot");
    if (posts.length === 0) { showError("No posts found for r/" + subreddit); return; }

    // Also fetch new + top for more data (with delay to avoid rate limits)
    showProgress("Fetching new feed...", 8);
    await sleep(7000);
    const newPosts = await fetchPosts(subreddit, "new");
    showProgress("Fetching top feed...", 12);
    await sleep(7000);
    const topPosts = await fetchPosts(subreddit, "top");

    // Deduplicate
    const seen = new Set(posts.map(p => p.id));
    for (const p of newPosts) if (!seen.has(p.id)) { posts.push(p); seen.add(p.id); }
    for (const p of topPosts) if (!seen.has(p.id)) { posts.push(p); seen.add(p.id); }

    showProgress("Got " + posts.length + " unique posts. Analyzing...", 15);

    // 2. Map to records (no comments in RSS mode)
    const records = mapToRecords(posts, {});
    const allPrompts = records.flatMap(r => r.prompts);
    const allTexts = allPrompts.map(p => p.text);
    if (allTexts.length === 0) { showError("No text content found in posts."); return; }
    showProgress("Analyzing " + allTexts.length + " texts...", 20);

    // 4. Embed
    const t0 = performance.now();
    const embeddings = await embedTexts(allTexts, "texts");
    const embedMs = performance.now() - t0;

    // 5. Analyze
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
      totals: {
        posts: posts.length,
        comments: 0,
        texts: allTexts.length,
        dateStart: Math.min(...records.map(r => r.date)),
        dateEnd: Math.max(...records.map(r => r.date)),
      },
      embedMs,
    });

    hideProgress();
  } catch (err) {
    hideProgress();
    showError(err.message);
  } finally {
    document.getElementById("analyze-btn").disabled = false;
  }
};
</script>
</body>
</html>`;
