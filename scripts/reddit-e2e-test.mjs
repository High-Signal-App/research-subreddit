/**
 * End-to-end test of the Reddit Memory Experiment UI pipeline.
 * Runs the exact same logic as the browser: fetch RSS via proxy →
 * map to records → embed → cluster → tone → evolution → render.
 * Prints the final output as the UI would show it.
 */

const BASE = "http://localhost:7421";
const SUBREDDIT = process.argv[2] || "LocalLLaMA";

async function fetchPosts(sort) {
  let path;
  if (sort === "top") path = `/r/${SUBREDDIT}/top/.rss?t=month`;
  else if (sort === "new") path = `/r/${SUBREDDIT}/new/.rss`;
  else path = `/r/${SUBREDDIT}/.rss`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(BASE + "/api/reddit" + path);
    if (res.ok) {
      const data = await res.json();
      return data.posts || [];
    }
    const body = await res.json().catch(() => ({}));
    if (body.resetIn) {
      const wait = body.resetIn + 5;
      console.log(`    429, waiting ${wait}s (attempt ${attempt + 1}/4)...`);
      await sleep(wait * 1000);
      continue;
    }
    throw new Error(`Reddit error: ${body.error || res.status}`);
  }
  throw new Error("Rate-limited after 4 attempts");
}

function mapToRecords(posts) {
  return posts.map((post) => {
    const date = (post.created_utc ?? 0) * 1000;
    const prompts = [];
    if (post.title) prompts.push({ id: `${post.id}-t`, text: post.title, date });
    if (post.selftext && post.selftext.length > 20)
      prompts.push({ id: `${post.id}-b`, text: post.selftext.slice(0, 2000), date });
    return {
      id: post.id, title: post.title, date,
      score: post.score ?? 0, author: post.author ?? "",
      prompts,
    };
  });
}

// ─── Embedding (Node-side, same model) ─────────────────────────────────────
import { pipeline } from "@huggingface/transformers";

let extractor = null;
async function embedTexts(texts, label) {
  if (!extractor) {
    console.log(`  loading model...`);
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
  }
  const embeddings = [];
  const BATCH = 16;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    for (let j = 0; j < batch.length; j++) embeddings.push(Float32Array.from(output[j].data));
    process.stdout.write(`\r  ${Math.min(i + BATCH, texts.length)}/${texts.length} ${label} embedded`);
  }
  console.log();
  return embeddings;
}

function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// ─── Analysis (same as UI) ─────────────────────────────────────────────────

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
        avgSim: cluster.reduce((s, idx) => (idx === i ? s : s + cosineSim(embeddings[i], embeddings[idx])), 0) / (cluster.length - 1),
        texts: cluster.map((idx) => texts[idx].slice(0, 120)),
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
  const assignments = embeddings.map((emb) => {
    let best = 0, bestSim = -1;
    for (let a = 0; a < anchorEmbeds.length; a++) {
      const sim = cosineSim(emb, anchorEmbeds[a]);
      if (sim > bestSim) { bestSim = sim; best = a; }
    }
    return { topicIdx: best, sim: bestSim };
  });
  return TOPIC_ANCHORS.map(([label], idx) => {
    const members = assignments.map((a, i) => ({ ...a, i })).filter((a) => a.topicIdx === idx);
    return {
      label, count: members.length,
      avgSim: members.reduce((s, a) => s + a.sim, 0) / Math.max(1, members.length),
      examples: members.map((m) => texts[m.i].slice(0, 100)).slice(0, 3),
    };
  }).filter((t) => t.count > 0).sort((a, b) => b.count - a.count);
}

const POS_WORDS = new Set("awesome best better great good happy helpful love nice perfect progress proud useful win wonderful excited amazing".split(" "));
const NEG_WORDS = new Set("angry annoyed anxious awful bad broken confused difficult disappointed error fail failed failing frustrated hate hard horrible issue problem sad stuck terrible useless worse worst wrong".split(" "));
const EMOTION_PATTERNS = {
  curiosity: [/\b(?:why|how|what|wonder|curious|explain|understand|learn|explore|discover)\b/i],
  frustration: [/\b(?:stuck|broken|fail(?:ed|ing)?|error|annoyed|frustrat(?:ed|ing)|hate|wrong|useless|doesn'?t work|not working)\b/i],
  urgency: [/\b(?:urgent|asap|quickly|right now|immediately|deadline|hurry)\b/i],
  uncertainty: [/\b(?:unsure|maybe|might|could|perhaps|confused|not sure|uncertain)\b/i],
  excitement: [/\b(?:excited|amazing|awesome|love|can'?t wait|great|wonderful|super)\b/i],
  appreciation: [/\b(?:thanks|thank you|appreciate|helpful|grateful)\b/i],
};

function analyzeTone(texts) {
  let pos = 0, neu = 0, neg = 0;
  const emotions = { curiosity: 0, frustration: 0, urgency: 0, uncertainty: 0, excitement: 0, appreciation: 0, neutral: 0 };
  for (const text of texts) {
    const words = text.toLowerCase().split(/\s+/);
    let p = 0, n = 0;
    for (const w of words) { if (POS_WORDS.has(w)) p++; if (NEG_WORDS.has(w)) n++; }
    if (p > n) pos++; else if (n > p) neg++; else neu++;
    let found = false;
    for (const [e, pats] of Object.entries(EMOTION_PATTERNS)) {
      if (pats.some((p) => p.test(text))) { emotions[e]++; found = true; break; }
    }
    if (!found) emotions.neutral++;
  }
  return { pos, neu, neg, emotions, total: texts.length };
}

function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
  const centroids = months.map((mk) => {
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
    drift.push({ from: centroids[i - 1].month, to: centroids[i].month, sim, drift: sim < 0.82 ? "significant" : sim < 0.90 ? "moderate" : "minimal" });
  }
  const monthly = months.map((mk) => {
    const items = byMonth.get(mk);
    return { month: mk, count: items.length, titles: items.map((it) => it.rec.title.slice(0, 70)).slice(0, 5) };
  });
  return { months, drift, monthly };
}

function pct(n, t) { return t > 0 ? ((n / t) * 100).toFixed(1) + "%" : "0%"; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  End-to-End Test: r/${SUBREDDIT.padEnd(42)}║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

  // 1. Fetch hot feed
  console.log(`[1] Fetching hot RSS feed...`);
  let posts = await fetchPosts("hot");
  console.log(`    got ${posts.length} posts`);

  // 2. Fetch new feed (with delay)
  console.log(`[2] Fetching new RSS feed (waiting for rate limit)...`);
  await sleep(35000);
  const newPosts = await fetchPosts("new");
  console.log(`    got ${newPosts.length} posts`);

  // 3. Fetch top feed
  console.log(`[3] Fetching top RSS feed (waiting for rate limit)...`);
  await sleep(35000);
  const topPosts = await fetchPosts("top");
  console.log(`    got ${topPosts.length} posts`);

  // Deduplicate
  const seen = new Set(posts.map((p) => p.id));
  for (const p of newPosts) if (!seen.has(p.id)) { posts.push(p); seen.add(p.id); }
  for (const p of topPosts) if (!seen.has(p.id)) { posts.push(p); seen.add(p.id); }
  console.log(`    ${posts.length} unique posts total\n`);

  // 4. Map to records
  const records = mapToRecords(posts);
  const allPrompts = records.flatMap((r) => r.prompts);
  const allTexts = allPrompts.map((p) => p.text);
  const postsWithSelftext = posts.filter((p) => p.selftext && p.selftext.length > 20).length;
  console.log(`[4] Mapped: ${records.length} posts, ${allTexts.length} texts (${postsWithSelftext} with selftext)\n`);

  // 5. Embed
  console.log(`[5] Embedding ${allTexts.length} texts...`);
  const t0 = Date.now();
  const embeddings = await embedTexts(allTexts, "texts");
  const embedMs = Date.now() - t0;
  console.log(`    done in ${(embedMs / 1000).toFixed(1)}s\n`);

  // 6. Analyze
  console.log(`[6] Running analysis...`);
  const repeats = findRepeats(allTexts, embeddings, 0.72);
  console.log(`    repeats: ${repeats.length} groups`);
  const topics = await clusterTopics(allTexts, embeddings);
  console.log(`    topics: ${topics.length} clusters`);
  const tone = analyzeTone(allTexts);
  console.log(`    tone: ${tone.pos}+/${tone.neu}n/${tone.neg}-\n`);

  // Evolution
  const postTitles = records.map((r) => r.title);
  const postEmbeds = await embedTexts(postTitles, "titles");
  const evolution = analyzeEvolution(records, postEmbeds);

  // ─── Final output (what the UI renders) ──────────────────────────────────
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  FINAL OUTPUT (as shown in UI): r/${SUBREDDIT}`);
  console.log(`${"═".repeat(70)}\n`);

  console.log(`── Totals ──`);
  console.log(`  Posts: ${posts.length}    Texts: ${allTexts.length}    Embed time: ${(embedMs / 1000).toFixed(1)}s`);
  console.log(`  Date range: ${new Date(Math.min(...records.map((r) => r.date))).toISOString().slice(0, 10)} → ${new Date(Math.max(...records.map((r) => r.date))).toISOString().slice(0, 10)}\n`);

  console.log(`── Recurring Questions / Themes ──  [${repeats.length} groups]`);
  if (repeats.length === 0) {
    console.log(`  No semantic repeats found at threshold 0.72.`);
  } else {
    repeats.slice(0, 10).forEach((g, i) => {
      console.log(`\n  ${i + 1}. [${g.count}x, sim ${g.avgSim.toFixed(3)}] "${g.representative}"`);
      g.texts.slice(0, 2).forEach((t) => console.log(`     → "${t}"`));
    });
  }
  console.log();

  console.log(`── Topic Clusters ──`);
  topics.forEach((t, i) => {
    console.log(`\n  ${i + 1}. ${t.label} — ${t.count} texts (avg sim ${t.avgSim.toFixed(3)})`);
    t.examples.forEach((ex) => console.log(`     → "${ex}"`));
  });
  console.log();

  console.log(`── Tone & Emotion ──`);
  console.log(`  Positive: ${pct(tone.pos, tone.total)}  Neutral: ${pct(tone.neu, tone.total)}  Negative: ${pct(tone.neg, tone.total)}`);
  console.log(`\n  Emotions:`);
  Object.entries(tone.emotions).sort((a, b) => b[1] - a[1]).forEach(([e, c]) => {
    console.log(`    ${e.padEnd(15)} ${c} (${pct(c, tone.total)})`);
  });
  console.log();

  console.log(`── Evolution ──`);
  if (evolution.note) {
    console.log(`  ${evolution.note}`);
  } else {
    console.log(`  Months: ${evolution.months.join(", ")}\n`);
    evolution.monthly.forEach((m) => {
      console.log(`  ${m.month} (${m.count} posts):`);
      m.titles.forEach((t) => console.log(`    → "${t}"`));
    });
    console.log(`\n  Centroid drift:`);
    evolution.drift.forEach((d) => {
      console.log(`    ${d.from} → ${d.to}: sim=${d.sim.toFixed(3)} (${d.drift})`);
    });
  }
  console.log();

  const ok = [repeats.length > 0, topics.filter((t) => t.count >= 2).length >= 3, tone.total > 0, evolution.drift?.length > 0].filter(Boolean).length;
  console.log(`${"═".repeat(70)}`);
  console.log(`  Signal quality: ${ok}/4 lenses produced useful output`);
  console.log(`  Verdict: ${ok >= 2 ? "PASS — engine works on subreddit data" : "NEEDS INVESTIGATION"}`);
  console.log(`${"═".repeat(70)}\n`);
}

main().catch((err) => { console.error("\nFailed:", err.message); process.exit(1); });
