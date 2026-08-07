/**
 * Generates a static HTML results page by running the analysis in Node
 * (using Transformers.js server-side) and embedding the rendered results
 * directly in the HTML — no browser model download needed.
 *
 * Usage: node scripts/reddit-experiment-static.mjs <subreddit>
 */

import { pipeline } from "@huggingface/transformers";
import { writeFileSync } from "node:fs";

const SUBREDDIT = process.argv[2] || "LocalLLaMA";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── RSS fetching ─────────────────────────────────────────────────────────

async function fetchRss(sort) {
  let path;
  if (sort === "top") path = `/r/${encodeURIComponent(SUBREDDIT)}/top/.rss?t=month`;
  else if (sort === "new") path = `/r/${encodeURIComponent(SUBREDDIT)}/new/.rss`;
  else path = `/r/${encodeURIComponent(SUBREDDIT)}/.rss`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://www.reddit.com${path}`, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
    });
    if (res.status === 429) {
      const reset = parseInt(res.headers.get("x-ratelimit-reset") || "30", 10);
      console.log(`  429, waiting ${reset + 5}s...`);
      await sleep((reset + 5) * 1000);
      continue;
    }
    if (res.status === 403) { await sleep(35000); continue; }
    if (!res.ok) throw new Error(`reddit ${res.status}`);
    return await res.text();
  }
  throw new Error("rate-limited");
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function parseAtomFeed(xml) {
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const title = tag(b, "title");
    const pub = tag(b, "published") || tag(b, "updated");
    const id = tag(b, "id").replace("t3_", "");
    const author = tag(b, "name").replace("/u/", "");
    const link = attr(b, "link", "href");
    const content = raw(b, "content");
    let selftext = "";
    const dec = decode(content);
    const sc = dec.match(/<!-- SC_OFF -->([\s\S]*?)<!-- SC_ON -->/);
    if (sc) selftext = strip(sc[1]).trim();
    entries.push({ id, title, selftext, author, created_utc: new Date(pub).getTime() / 1000, permalink: link || "" });
  }
  return entries;
}

function tag(b, t) { const m = b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`)); return m ? decode(m[1].trim()) : ""; }
function raw(b, t) { const m = b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`)); return m ? m[1] : ""; }
function attr(b, t, a) { const m = b.match(new RegExp(`<${t}[^>]*${a}="([^"]*)"`)); return m ? m[1] : ""; }
function decode(s) { return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#32;/g, " "); }
function strip(h) { return decode(h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")); }

// ─── Analysis (same logic as UI) ──────────────────────────────────────────

let extractor = null;
async function embedTexts(texts) {
  if (!extractor) {
    console.log("  loading model...");
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
  }
  const embs = [];
  for (let i = 0; i < texts.length; i += 16) {
    const batch = texts.slice(i, i + 16);
    const out = await extractor(batch, { pooling: "mean", normalize: true });
    for (let j = 0; j < batch.length; j++) embs.push(Float32Array.from(out[j].data));
    process.stdout.write(`\r  ${Math.min(i + 16, texts.length)}/${texts.length} embedded`);
  }
  console.log();
  return embs;
}

function cos(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; }

function findRepeats(texts, embs, th = 0.72) {
  const groups = [], used = new Set();
  for (let i = 0; i < texts.length; i++) {
    if (used.has(i)) continue;
    const cl = [i]; used.add(i);
    for (let j = i + 1; j < texts.length; j++) { if (!used.has(j) && cos(embs[i], embs[j]) >= th) { cl.push(j); used.add(j); } }
    if (cl.length >= 2) groups.push({ rep: texts[i].slice(0, 150), count: cl.length, avgSim: cl.reduce((s, x) => x === i ? s : s + cos(embs[i], embs[x]), 0) / (cl.length - 1), texts: cl.map(x => texts[x].slice(0, 120)) });
  }
  return groups.sort((a, b) => b.count - a.count);
}

const ANCHORS = [
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

async function clusterTopics(texts, embs) {
  const ae = await embedTexts(ANCHORS.map(([, t]) => t));
  const asg = embs.map(e => { let b = 0, bs = -1; for (let a = 0; a < ae.length; a++) { const s = cos(e, ae[a]); if (s > bs) { bs = s; b = a; } } return { ti: b, s: bs }; });
  return ANCHORS.map(([label], i) => {
    const ms = asg.map((a, j) => ({ ...a, j })).filter(a => a.ti === i);
    return { label, count: ms.length, avgSim: ms.reduce((s, a) => s + a.s, 0) / Math.max(1, ms.length), examples: ms.map(m => texts[m.j].slice(0, 100)).slice(0, 3) };
  }).filter(t => t.count > 0).sort((a, b) => b.count - a.count);
}

const POS = new Set("awesome best better great good happy helpful love nice perfect progress proud useful win wonderful excited amazing".split(" "));
const NEG = new Set("angry annoyed anxious awful bad broken confused difficult disappointed error fail failed failing frustrated hate hard horrible issue problem sad stuck terrible useless worse worst wrong".split(" "));
const EMO = {
  curiosity: [/\b(?:why|how|what|wonder|curious|explain|understand|learn|explore|discover)\b/i],
  frustration: [/\b(?:stuck|broken|fail(?:ed|ing)?|error|annoyed|frustrat(?:ed|ing)|hate|wrong|useless|doesn'?t work|not working)\b/i],
  urgency: [/\b(?:urgent|asap|quickly|right now|immediately|deadline|hurry)\b/i],
  uncertainty: [/\b(?:unsure|maybe|might|could|perhaps|confused|not sure|uncertain)\b/i],
  excitement: [/\b(?:excited|amazing|awesome|love|can'?t wait|great|wonderful|super)\b/i],
  appreciation: [/\b(?:thanks|thank you|appreciate|helpful|grateful)\b/i],
};

function analyzeTone(texts) {
  let p = 0, n = 0, ne = 0;
  const em = { curiosity: 0, frustration: 0, urgency: 0, uncertainty: 0, excitement: 0, appreciation: 0, neutral: 0 };
  for (const t of texts) {
    const ws = t.toLowerCase().split(/\s+/);
    let pp = 0, nn = 0;
    for (const w of ws) { if (POS.has(w)) pp++; if (NEG.has(w)) nn++; }
    if (pp > nn) p++; else if (nn > pp) n++; else ne++;
    let f = false;
    for (const [e, ps] of Object.entries(EMO)) { if (ps.some(x => x.test(t))) { em[e]++; f = true; break; } }
    if (!f) em.neutral++;
  }
  return { pos: p, neu: ne, neg: n, emotions: em, total: texts.length };
}

function mkKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

function analyzeEvolution(records, embs) {
  const bm = new Map();
  records.forEach((r, i) => { const k = mkKey(r.date); if (!bm.has(k)) bm.set(k, []); bm.get(k).push({ r, e: embs[i] }); });
  const months = [...bm.keys()].sort();
  if (months.length < 2) return { months, note: "Need multiple months for evolution analysis" };
  const cs = months.map(k => { const is = bm.get(k); const d = is[0].e.length; const c = new Float32Array(d); for (const it of is) for (let i = 0; i < d; i++) c[i] += it.e[i]; for (let i = 0; i < d; i++) c[i] /= is.length; return { m: k, c, n: is.length }; });
  const drift = [];
  for (let i = 1; i < cs.length; i++) { const s = cos(cs[i-1].c, cs[i].c); drift.push({ from: cs[i-1].m, to: cs[i].m, sim: s, drift: s < 0.82 ? "significant" : s < 0.90 ? "moderate" : "minimal" }); }
  const monthly = months.map(k => { const is = bm.get(k); return { m: k, n: is.length, titles: is.map(it => it.r.title.slice(0, 70)).slice(0, 5) }; });
  return { months, drift, monthly };
}

function pct(n, t) { return t > 0 ? ((n / t) * 100).toFixed(1) + "%" : "0%"; }
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// ─── Generate HTML ────────────────────────────────────────────────────────

function generateHTML(data) {
  const { subreddit, posts, records, repeats, topics, tone, evolution, totals, embedMs } = data;
  let h = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reddit Memory Experiment — r/${esc(subreddit)}</title>
<style>
  :root { --bg:#0a0a0a; --surface:#141414; --border:#262626; --text:#e5e5e5; --dim:#737373; --accent:#22d3ee; --pos:#4ade80; --neg:#f87171; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:ui-sans-serif,system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--text); line-height:1.6; padding:2rem; max-width:900px; margin:0 auto; }
  h1 { font-size:1.5rem; font-weight:600; margin-bottom:0.25rem; }
  h2 { font-size:1.1rem; font-weight:600; margin:2rem 0 0.75rem; color:var(--accent); border-bottom:1px solid var(--border); padding-bottom:0.4rem; }
  .sub { color:var(--dim); font-size:0.85rem; margin-bottom:1.5rem; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:1rem 1.2rem; margin-bottom:0.75rem; }
  .repeat-group .rep { font-weight:500; }
  .repeat-group .meta { color:var(--dim); font-size:0.8rem; }
  .repeat-group .examples { color:var(--dim); font-size:0.8rem; margin-left:1rem; margin-top:0.25rem; }
  .topic-row { display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0; border-bottom:1px solid var(--border); }
  .topic-row:last-child { border-bottom:none; }
  .topic-label { font-weight:500; }
  .topic-count { color:var(--accent); font-variant-numeric:tabular-nums; font-size:0.85rem; }
  .topic-examples { color:var(--dim); font-size:0.78rem; margin-top:0.2rem; }
  .tone-bar { display:flex; height:24px; border-radius:4px; overflow:hidden; margin:0.5rem 0; }
  .tone-bar .seg { display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:600; }
  .tone-bar .pos { background:var(--pos); color:#000; }
  .tone-bar .neu { background:#333; color:#fff; }
  .tone-bar .neg { background:var(--neg); color:#fff; }
  .emotion-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:0.5rem; margin-top:0.5rem; }
  .emotion-cell { background:var(--bg); border:1px solid var(--border); border-radius:4px; padding:0.5rem; }
  .emotion-cell .name { font-size:0.8rem; color:var(--dim); }
  .emotion-cell .val { font-size:1.1rem; font-weight:600; font-variant-numeric:tabular-nums; }
  .evolution-month .month-label { font-weight:500; color:var(--accent); }
  .evolution-month .titles { color:var(--dim); font-size:0.8rem; margin-left:1rem; }
  .drift-row { display:flex; justify-content:space-between; padding:0.3rem 0; font-size:0.85rem; border-bottom:1px solid var(--border); }
  .drift-row:last-child { border-bottom:none; }
  .totals-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:0.5rem; margin-bottom:0.5rem; }
  .total-cell { background:var(--bg); border:1px solid var(--border); border-radius:4px; padding:0.6rem; }
  .total-cell .label { font-size:0.75rem; color:var(--dim); }
  .total-cell .value { font-size:1.3rem; font-weight:600; font-variant-numeric:tabular-nums; }
  .badge { display:inline-block; padding:0.1rem 0.5rem; border-radius:4px; font-size:0.75rem; font-weight:600; }
  .badge-ok { background:#0d3320; color:var(--pos); }
  .badge-no { background:#3d1212; color:var(--neg); }
</style></head><body>

<h1>Reddit Memory Experiment — r/${esc(subreddit)}</h1>
<p class="sub">${posts.length} posts analyzed · ${totals.texts} texts · embedded in ${(embedMs/1000).toFixed(1)}s · ${new Date(totals.dateStart).toISOString().slice(0,10)} → ${new Date(totals.dateEnd).toISOString().slice(0,10)}</p>

<h2>Totals</h2>
<div class="totals-grid">
  <div class="total-cell"><div class="label">Posts</div><div class="value">${totals.posts}</div></div>
  <div class="total-cell"><div class="label">Texts</div><div class="value">${totals.texts}</div></div>
  <div class="total-cell"><div class="label">Embed time</div><div class="value">${(embedMs/1000).toFixed(1)}s</div></div>
</div>

<h2>Recurring Questions / Themes <span class="badge ${repeats.length > 0 ? "badge-ok" : "badge-no"}">${repeats.length} groups</span></h2>
`;

  if (repeats.length === 0) {
    h += `<p class="sub">No semantic repeats found at threshold 0.72.</p>`;
  } else {
    for (const g of repeats.slice(0, 12)) {
      h += `<div class="card repeat-group"><div class="rep">${esc(g.rep)}</div><div class="meta">${g.count}x, avg similarity ${g.avgSim.toFixed(3)}</div><div class="examples">`;
      for (const t of g.texts.slice(0, 3)) h += `→ ${esc(t)}<br>`;
      h += `</div></div>`;
    }
  }

  h += `<h2>Topic Clusters</h2>`;
  for (const t of topics) {
    h += `<div class="card"><div class="topic-row"><span class="topic-label">${esc(t.label)}</span><span class="topic-count">${t.count} texts</span></div><div class="topic-examples">`;
    for (const ex of t.examples) h += `→ ${esc(ex)}<br>`;
    h += `</div></div>`;
  }

  h += `<h2>Tone & Emotion</h2><div class="card">`;
  const tp = tone.total || 1;
  h += `<div class="tone-bar">`;
  h += `<div class="seg pos" style="width:${(tone.pos/tp*100)}%">${tone.pos > 0 ? pct(tone.pos, tone.total) : ""}</div>`;
  h += `<div class="seg neu" style="width:${(tone.neu/tp*100)}%">${tone.neu > 0 ? pct(tone.neu, tone.total) : ""}</div>`;
  h += `<div class="seg neg" style="width:${(tone.neg/tp*100)}%">${tone.neg > 0 ? pct(tone.neg, tone.total) : ""}</div>`;
  h += `</div><div class="emotion-grid">`;
  for (const [e, c] of Object.entries(tone.emotions).sort((a, b) => b[1] - a[1])) {
    h += `<div class="emotion-cell"><div class="name">${e}</div><div class="val">${c}</div></div>`;
  }
  h += `</div></div>`;

  h += `<h2>Evolution</h2>`;
  if (evolution.note) {
    h += `<p class="sub">${evolution.note}</p>`;
  } else {
    h += `<div class="card">`;
    for (const m of evolution.monthly) {
      h += `<div class="evolution-month"><div class="month-label">${m.m} (${m.n} posts)</div><div class="titles">`;
      for (const t of m.titles) h += `→ ${esc(t)}<br>`;
      h += `</div></div>`;
    }
    h += `<div style="margin-top:0.75rem"><strong>Centroid drift:</strong></div>`;
    for (const d of evolution.drift) {
      h += `<div class="drift-row"><span>${d.from} → ${d.to}</span><span>sim=${d.sim.toFixed(3)} (${d.drift})</span></div>`;
    }
    h += `</div>`;
  }

  h += `</body></html>`;
  return h;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  Reddit Memory Experiment — r/${SUBREDDIT}\n`);

  console.log("  Fetching RSS feeds...");
  let posts = parseAtomFeed(await fetchRss("hot"));
  console.log(`    hot: ${posts.length}`);
  await sleep(35000);
  const np = parseAtomFeed(await fetchRss("new"));
  console.log(`    new: ${np.length}`);
  await sleep(35000);
  const tp = parseAtomFeed(await fetchRss("top"));
  console.log(`    top: ${tp.length}`);
  const seen = new Set(posts.map(p => p.id));
  for (const p of np) if (!seen.has(p.id)) { posts.push(p); seen.add(p.id); }
  for (const p of tp) if (!seen.has(p.id)) { posts.push(p); seen.add(p.id); }
  console.log(`    ${posts.length} unique posts\n`);

  // Map to records
  const records = posts.map(p => {
    const date = (p.created_utc ?? 0) * 1000;
    const prompts = [];
    if (p.title) prompts.push({ text: p.title, date });
    if (p.selftext && p.selftext.length > 20) prompts.push({ text: p.selftext.slice(0, 2000), date });
    return { id: p.id, title: p.title, date, prompts };
  });
  const allTexts = records.flatMap(r => r.prompts).map(p => p.text);
  console.log(`  ${allTexts.length} texts to embed\n`);

  // Embed
  const t0 = Date.now();
  const embs = await embedTexts(allTexts);
  const embedMs = Date.now() - t0;

  // Analyze
  console.log("  Analyzing...");
  const repeats = findRepeats(allTexts, embs);
  const topics = await clusterTopics(allTexts, embs);
  const tone = analyzeTone(allTexts);
  const postEmbs = await embedTexts(records.map(r => r.title));
  const evolution = analyzeEvolution(records, postEmbs);

  // Generate HTML
  const html = generateHTML({
    subreddit: SUBREDDIT, posts, records, repeats, topics, tone, evolution,
    totals: { posts: posts.length, texts: allTexts.length, dateStart: Math.min(...records.map(r => r.date)), dateEnd: Math.max(...records.map(r => r.date)) },
    embedMs,
  });

  writeFileSync("/tmp/reddit-experiment-static.html", html);
  console.log("\n  Static HTML saved to /tmp/reddit-experiment-static.html");
  console.log("  Open with: open /tmp/reddit-experiment-static.html\n");
}

main().catch(err => { console.error("Failed:", err.message); process.exit(1); });
