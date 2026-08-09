/**
 * Reddit Memory Analysis — runs on stored data, produces the full report.
 *
 * Lenses:
 *   1. Recurring questions (filtered: only actual questions, not announcements)
 *   2. Topic clusters (anchor-based)
 *   3. Tone & emotion (posts + comments)
 *   4. Comment grouping per question (semantic clusters of answers)
 *   5. Evolution (monthly topic + tone drift)
 *   6. Community health (answer rate, engagement, sentiment trajectory)
 *
 * Usage: node scripts/reddit-memory-analyze.mjs <subreddit> [--days=N]
 */

import { pipeline } from "@huggingface/transformers";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const SUBREDDIT = process.argv[2] || "LocalLLaMA";
const PERIOD_DAYS = (() => {
  const arg = process.argv.find(a => a.startsWith("--days="));
  return arg ? parseInt(arg.split("=")[1], 10) : null;
})();
const STORAGE_FILE = join(process.cwd(), "data", "reddit-memory", `${SUBREDDIT}.json`);
const CACHE_DIR = join(process.cwd(), "data", "reddit-memory", "cache");
const CACHE_FILE = join(CACHE_DIR, `${SUBREDDIT}-embeddings.json`);
const USE_CACHE = !process.argv.includes("--no-cache");

// ─── Embedding (with disk cache) ──────────────────────────────────────────

let extractor = null;
let embeddingCache = null;
let cacheDirty = false;

function loadCache() {
  if (!USE_CACHE) return {};
  if (embeddingCache !== null) return embeddingCache;
  if (existsSync(CACHE_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
      // Convert arrays back to Float32Array
      embeddingCache = {};
      for (const [hash, arr] of Object.entries(raw)) {
        embeddingCache[hash] = new Float32Array(arr);
      }
      console.log(`  embedding cache: ${Object.keys(embeddingCache).length} entries loaded`);
      return embeddingCache;
    } catch {
      console.log("  embedding cache: failed to load, starting fresh");
    }
  }
  embeddingCache = {};
  return embeddingCache;
}

function saveCache() {
  if (!USE_CACHE || !cacheDirty || !embeddingCache) return;
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  // Convert Float32Array to regular arrays for JSON
  const serializable = {};
  for (const [hash, arr] of Object.entries(embeddingCache)) {
    serializable[hash] = Array.from(arr);
  }
  writeFileSync(CACHE_FILE, JSON.stringify(serializable));
  console.log(`  embedding cache: ${Object.keys(embeddingCache).length} entries saved`);
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function embed(texts) {
  const cache = loadCache();
  const out = new Array(texts.length);
  const needIdx = [];

  // Check cache first
  for (let i = 0; i < texts.length; i++) {
    const h = hashText(texts[i]);
    if (cache[h]) {
      out[i] = cache[h];
    } else {
      needIdx.push(i);
    }
  }

  const cached = texts.length - needIdx.length;
  if (cached > 0) console.log(`  embedding: ${cached}/${texts.length} from cache, ${needIdx.length} to compute`);

  if (needIdx.length === 0) return out;

  if (!extractor) {
    console.log("  loading model...");
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
  }

  // Compute embeddings for uncached texts
  const batchSize = 16;
  for (let bi = 0; bi < needIdx.length; bi += batchSize) {
    const batchIdx = needIdx.slice(bi, bi + batchSize);
    const batchTexts = batchIdx.map(i => texts[i]);
    const res = await extractor(batchTexts, { pooling: "mean", normalize: true });
    for (let j = 0; j < batchIdx.length; j++) {
      const emb = Float32Array.from(res[j].data);
      out[batchIdx[j]] = emb;
      cache[hashText(texts[batchIdx[j]])] = emb;
      cacheDirty = true;
    }
    process.stdout.write(`\r  ${Math.min(bi + batchSize, needIdx.length)}/${needIdx.length} computed`);
  }
  console.log();
  return out;
}

function cos(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; }

// ─── Question vs announcement filter ──────────────────────────────────────

const QUESTION_PATTERNS = [
  /\?\s*$/,                    // ends with ?
  /^(how|what|why|where|when|which|who|can|could|should|would|is|are|do|does|did|will|has|have)\b/i,
  /\b(?:anyone|any way|how do|how can|how to|what's the best|recommend|suggestion|advice|help me)\b/i,
  /\b(?:looking for|searching for|need (?:a|an|some|help))\b/i,
];

const ANNOUNCEMENT_PATTERNS = [
  /^(released|announced|launched|update|new|breaking|just (?:released|finished|posted|got))\b/i,
  /\b(?:now available|weights released|open sourced|just dropped|is out|is live)\b/i,
];

function isQuestion(text) {
  if (text.length < 15) return false;
  // Strong question signal
  if (text.trim().endsWith("?")) return true;
  // Check patterns
  const isQ = QUESTION_PATTERNS.some(p => p.test(text));
  const isA = ANNOUNCEMENT_PATTERNS.some(p => p.test(text));
  return isQ && !isA;
}

// ─── Analysis functions ───────────────────────────────────────────────────

function findRecurringQuestions(texts, embeddings, threshold = 0.75) {
  // Only consider texts that are questions
  const questionIdxs = texts.map((t, i) => isQuestion(t) ? i : -1).filter(i => i >= 0);
  if (questionIdxs.length < 2) return [];

  const groups = [];
  const used = new Set();
  for (const i of questionIdxs) {
    if (used.has(i)) continue;
    const cluster = [i];
    used.add(i);
    for (const j of questionIdxs) {
      if (j <= i || used.has(j)) continue;
      if (cos(embeddings[i], embeddings[j]) >= threshold) {
        cluster.push(j);
        used.add(j);
      }
    }
    if (cluster.length >= 2) {
      groups.push({
        question: texts[i].slice(0, 200),
        count: cluster.length,
        avgSim: cluster.reduce((s, x) => x === i ? s : s + cos(embeddings[i], embeddings[x]), 0) / (cluster.length - 1),
        instances: cluster.map(idx => ({ text: texts[idx].slice(0, 150), date: texts[idx + "_date"] })),
      });
    }
  }
  return groups.sort((a, b) => b.count - a.count);
}

// Load topic anchors from config file, fall back to defaults
const ANCHORS_FILE = join(process.cwd(), "config", "topic-anchors.json");
const SUBREDDIT_ANCHORS_FILE = join(process.cwd(), "data", "reddit-memory", `${SUBREDDIT}-anchors.json`);
const TOPIC_ANCHORS = (() => {
  // Try subreddit-specific anchors first, then default
  for (const f of [SUBREDDIT_ANCHORS_FILE, ANCHORS_FILE]) {
    if (existsSync(f)) {
      try {
        const data = JSON.parse(readFileSync(f, "utf8"));
        const anchors = data.default || data.anchors || data;
        if (Array.isArray(anchors) && anchors.length > 0) {
          console.log(`  topic anchors: loaded ${anchors.length} from ${f.split("/").pop()}`);
          return anchors;
        }
      } catch {}
    }
  }
  // Built-in fallback
  return [
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
    ["News & releases", "released announced launched new model weights open source update"],
    ["Community & meta", "subreddit community rules moderation discussion meta opinion"],
  ];
})();

async function clusterTopics(texts, embeddings) {
  const anchorTexts = TOPIC_ANCHORS.map(([, t]) => t);
  const anchorEmbeds = await embed(anchorTexts);
  const assignments = embeddings.map(e => {
    let best = 0, bestSim = -1;
    for (let a = 0; a < anchorEmbeds.length; a++) {
      const s = cos(e, anchorEmbeds[a]);
      if (s > bestSim) { bestSim = s; best = a; }
    }
    return { topicIdx: best, sim: bestSim };
  });
  return TOPIC_ANCHORS.map(([label], idx) => {
    const members = assignments.map((a, i) => ({ ...a, i })).filter(a => a.topicIdx === idx);
    // Show the most representative examples (highest similarity to anchor), not just the first ones
    const sorted = [...members].sort((a, b) => b.sim - a.sim);
    const topExamples = sorted.slice(0, 5).map(m => ({ text: texts[m.i].slice(0, 150), sim: m.sim }));
    return {
      label, count: members.length,
      avgSim: members.reduce((s, a) => s + a.sim, 0) / Math.max(1, members.length),
      topSim: sorted[0]?.sim || 0,
      examples: topExamples.map(e => e.text),
      exampleSims: topExamples.map(e => e.sim),
    };
  }).filter(t => t.count > 0).sort((a, b) => b.count - a.count);
}

// Assign each post to a topic (by embedding post title against topic anchors)
async function assignPostTopics(posts, topicLabels) {
  const anchorTexts = TOPIC_ANCHORS.map(([, t]) => t);
  const anchorEmbeds = await embed(anchorTexts);
  const postEmbeds = await embed(posts.map(p => (p.title + " " + (p.selftext || "")).slice(0, 500)));
  return posts.map((p, i) => {
    let best = 0, bestSim = -1;
    for (let a = 0; a < anchorEmbeds.length; a++) {
      const s = cos(postEmbeds[i], anchorEmbeds[a]);
      if (s > bestSim) { bestSim = s; best = a; }
    }
    return { topic: TOPIC_ANCHORS[best][0], topicIdx: best, sim: bestSim };
  });
}

function dayKey(ts) { return new Date(ts * 1000).toISOString().slice(0, 10); }
function weekKey(ts) {
  const d = new Date(ts * 1000);
  const day = d.getDay();
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  return start.toISOString().slice(0, 10);
}

// Generic time-bucketed topic distribution
function topicBreakdownForBuckets(posts, postTopics, keyFn, labelFn) {
  const byBucket = new Map();
  for (let i = 0; i < posts.length; i++) {
    const k = keyFn(posts[i].created_utc);
    if (!byBucket.has(k)) byBucket.set(k, {});
    const dist = byBucket.get(k);
    const topic = postTopics[i].topic;
    dist[topic] = (dist[topic] || 0) + 1;
  }
  const buckets = [...byBucket.keys()].sort();
  const topics = [...new Set(postTopics.map(t => t.topic))];
  return {
    buckets,
    labels: buckets.map(labelFn),
    topics,
    matrix: buckets.map(k => {
      const dist = byBucket.get(k);
      return topics.map(t => dist[t] || 0);
    }),
  };
}

// Generic time-bucketed tone+volume trajectory
function toneTrajectoryForBuckets(posts, keyFn, labelFn) {
  const byBucket = new Map();
  for (const p of posts) {
    const k = keyFn(p.created_utc);
    if (!byBucket.has(k)) byBucket.set(k, []);
    byBucket.get(k).push(p);
  }
  const buckets = [...byBucket.keys()].sort();
  return buckets.map(k => {
    const items = byBucket.get(k);
    const texts = items.map(p => p.title + " " + (p.selftext || ""));
    const tone = analyzeTone(texts);
    return {
      label: labelFn(k),
      postCount: items.length,
      commentCount: items.reduce((s, p) => s + (p.comments?.length || 0), 0),
      posPct: (tone.pos / tone.total) * 100,
      neuPct: (tone.neu / tone.total) * 100,
      negPct: (tone.neg / tone.total) * 100,
      avgScore: items.reduce((s, p) => s + (p.score || 0), 0) / items.length,
      avgComments: items.reduce((s, p) => s + (p.comments?.length || 0), 0) / items.length,
    };
  });
}

const POS_WORDS = new Set("awesome best better great good happy helpful love nice perfect progress proud useful win wonderful excited amazing thanks works".split(" "));
const NEG_WORDS = new Set("angry annoyed anxious awful bad broken confused difficult disappointed error fail failed failing frustrated hate hard horrible issue problem sad stuck terrible useless worse worst wrong broken".split(" "));
const EMO = {
  curiosity: [/\b(?:why|how|what|wonder|curious|explain|understand|learn|explore|discover)\b/i],
  frustration: [/\b(?:stuck|broken|fail(?:ed|ing)?|error|annoyed|frustrat(?:ed|ing)|hate|wrong|useless|doesn'?t work|not working)\b/i],
  urgency: [/\b(?:urgent|asap|quickly|right now|immediately|deadline|hurry)\b/i],
  uncertainty: [/\b(?:unsure|maybe|might|could|perhaps|confused|not sure|uncertain)\b/i],
  excitement: [/\b(?:excited|amazing|awesome|love|can'?t wait|great|wonderful|super|incredible)\b/i],
  appreciation: [/\b(?:thanks|thank you|appreciate|helpful|grateful|this is great|worked)\b/i],
};

function analyzeTone(texts) {
  let pos = 0, neu = 0, neg = 0;
  const emotions = { curiosity: 0, frustration: 0, urgency: 0, uncertainty: 0, excitement: 0, appreciation: 0, neutral: 0 };
  for (const t of texts) {
    const words = t.toLowerCase().split(/\s+/);
    let p = 0, n = 0;
    for (const w of words) { if (POS_WORDS.has(w)) p++; if (NEG_WORDS.has(w)) n++; }
    if (p > n) pos++; else if (n > p) neg++; else neu++;
    let found = false;
    for (const [e, ps] of Object.entries(EMO)) { if (ps.some(x => x.test(t))) { emotions[e]++; found = true; break; } }
    if (!found) emotions.neutral++;
  }
  return { pos, neu, neg, emotions, total: texts.length };
}

// ─── Comment grouping per question ────────────────────────────────────────

function groupComments(comments, embeddings, threshold = 0.45) {
  if (comments.length < 2) return comments.map((c, i) => ({ ...c, group: 0 }));

  const N = comments.length;

  // Precompute pairwise similarity matrix
  const simMatrix = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const s = cos(embeddings[i], embeddings[j]);
      simMatrix[i * N + j] = s;
      simMatrix[j * N + i] = s;
    }
  }

  // Agglomerative clustering with average linkage
  const clusters = comments.map((_, i) => [i]);
  let merged = true;
  while (merged && clusters.length > 1) {
    merged = false;
    let bestPair = [-1, -1];
    let bestSim = threshold;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let total = 0, count = 0;
        for (const a of clusters[i]) {
          for (const b of clusters[j]) {
            total += simMatrix[a * N + b];
            count++;
          }
        }
        const avgSim = total / count;
        if (avgSim >= bestSim) {
          bestSim = avgSim;
          bestPair = [i, j];
          merged = true;
        }
      }
    }
    if (merged) {
      clusters[bestPair[0]].push(...clusters[bestPair[1]]);
      clusters.splice(bestPair[1], 1);
    }
  }

  const groups = clusters.map((cluster, gi) => {
    const avgScore = cluster.reduce((s, idx) => s + (comments[idx].score || 0), 0) / cluster.length;
    const sorted = [...cluster].sort((a, b) => (comments[b].score || 0) - (comments[a].score || 0));
    return {
      groupId: gi,
      members: cluster.map(idx => comments[idx]),
      avgScore,
      representative: comments[sorted[0]].body.slice(0, 200),
      count: cluster.length,
    };
  });

  return groups.sort((a, b) => b.avgScore - a.avgScore);
}

// ─── Evolution (community phases + topic emergence) ───────────────────────

function monthKey(ts) { const d = new Date(ts * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

function analyzeEvolution(posts, embeddings, topicBreakdown) {
  // Use topicBreakdown if available to detect phase shifts and topic emergence
  if (topicBreakdown && topicBreakdown.buckets?.length > 1) {
    const { buckets: months, topics, matrix } = topicBreakdown;
    const monthTotals = matrix.map(row => row.reduce((a, b) => a + b, 0));

    // Only analyze months with adequate data
    const MIN_POSTS = 20;
    const adequateIdx = months.map((_, i) => i).filter(i => monthTotals[i] >= MIN_POSTS);

    // Topic emergence: when each topic first appeared and when it peaked
    const topicEmergence = topics.map((topic, ti) => {
      const firstMonth = months.find((_, mi) => matrix[mi][ti] > 0);
      const peakIdx = matrix.reduce((best, row, mi) => row[ti] > matrix[best][ti] ? mi : best, 0);
      const peakMonth = months[peakIdx];
      const peakCount = matrix[peakIdx][ti];
      // Trend: compare first half vs second half of adequate months
      const adequateVals = adequateIdx.map(i => matrix[i][ti]);
      if (adequateVals.length < 4) return { topic, firstMonth, peakMonth, peakCount, trend: "insufficient data" };
      const mid = Math.floor(adequateVals.length / 2);
      const firstHalfAvg = adequateVals.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
      const secondHalfAvg = adequateVals.slice(mid).reduce((a, b) => a + b, 0) / (adequateVals.length - mid);
      const trend = secondHalfAvg > firstHalfAvg * 1.3 ? "growing" : secondHalfAvg < firstHalfAvg * 0.7 ? "declining" : "stable";
      return { topic, firstMonth, peakMonth, peakCount, trend, firstHalfAvg: Math.round(firstHalfAvg * 10) / 10, secondHalfAvg: Math.round(secondHalfAvg * 10) / 10 };
    }).sort((a, b) => (a.firstMonth || "9999").localeCompare(b.firstMonth || "9999"));

    // Detect phase shifts: months where the dominant topic changes
    const phases = [];
    let currentPhase = null;
    for (const mi of adequateIdx) {
      // Find dominant topic this month
      let maxTi = 0, maxVal = 0;
      for (let ti = 0; ti < topics.length; ti++) {
        if (matrix[mi][ti] > maxVal) { maxVal = matrix[mi][ti]; maxTi = ti; }
      }
      const dominant = topics[maxTi];
      const total = monthTotals[mi];
      const dominantPct = total > 0 ? (maxVal / total) * 100 : 0;

      if (!currentPhase || currentPhase.dominantTopic !== dominant) {
        if (currentPhase) phases.push(currentPhase);
        currentPhase = {
          startMonth: months[mi],
          endMonth: months[mi],
          dominantTopic: dominant,
          dominantPct: Math.round(dominantPct),
          months: [months[mi]],
          postCounts: [total],
        };
      } else {
        currentPhase.endMonth = months[mi];
        currentPhase.months.push(months[mi]);
        currentPhase.postCounts.push(total);
      }
    }
    if (currentPhase) phases.push(currentPhase);

    // Summarize phases
    const phaseSummary = phases.map(p => ({
      period: p.startMonth === p.endMonth ? p.startMonth : `${p.startMonth} → ${p.endMonth}`,
      dominantTopic: p.dominantTopic,
      dominantPct: p.dominantPct,
      monthCount: p.months.length,
      totalPosts: p.postCounts.reduce((a, b) => a + b, 0),
    }));

    // Key shifts: months where a topic overtook another
    const keyShifts = [];
    for (let i = 1; i < adequateIdx.length; i++) {
      const prevMi = adequateIdx[i - 1], currMi = adequateIdx[i];
      for (let ti = 0; ti < topics.length; ti++) {
        for (let tj = ti + 1; tj < topics.length; tj++) {
          const prevDiff = matrix[prevMi][ti] - matrix[prevMi][tj];
          const currDiff = matrix[currMi][ti] - matrix[currMi][tj];
          // Crossover: one was ahead, now the other is
          if (prevDiff > 0 && currDiff < 0 && matrix[currMi][tj] > 5) {
            keyShifts.push({
              month: months[currMi],
              from: topics[ti],
              to: topics[tj],
              prevCounts: [matrix[prevMi][ti], matrix[prevMi][tj]],
              currCounts: [matrix[currMi][ti], matrix[currMi][tj]],
            });
          }
        }
      }
    }

    return { phases: phaseSummary, topicEmergence, keyShifts, analyzedMonths: adequateIdx.length, totalMonths: months.length };
  }

  // Fallback: simple month grouping
  const byMonth = new Map();
  posts.forEach(p => {
    const mk = monthKey(p.created_utc);
    if (!byMonth.has(mk)) byMonth.set(mk, []);
    byMonth.get(mk).push(p);
  });
  const months = [...byMonth.keys()].sort();
  return { months, note: "Topic breakdown not available for phase analysis" };
}

// ─── Community health ─────────────────────────────────────────────────────

function analyzeHealth(posts) {
  const totalPosts = posts.length;
  const postsWithComments = posts.filter(p => (p.comments?.length || 0) > 0).length;
  const totalComments = posts.reduce((s, p) => s + (p.comments?.length || 0), 0);
  const avgCommentsPerPost = totalPosts > 0 ? totalComments / totalPosts : 0;
  const answerRate = totalPosts > 0 ? (postsWithComments / totalPosts) * 100 : 0;

  // Score distribution
  const scores = posts.map(p => p.score || 0).sort((a, b) => b - a);
  const medianScore = scores.length > 0 ? scores[Math.floor(scores.length / 2)] : 0;

  // Top contributors
  const authorCounts = new Map();
  for (const p of posts) {
    const a = p.author || "[unknown]";
    authorCounts.set(a, (authorCounts.get(a) || 0) + 1);
  }
  const topAuthors = [...authorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return { totalPosts, postsWithComments, totalComments, avgCommentsPerPost, answerRate, medianScore, topAuthors };
}

// ─── Moderation analysis ──────────────────────────────────────────────────

function analyzeModeration(posts) {
  const total = posts.length;
  let totalComments = 0;

  // Post-level moderation signals
  const deletedAuthors = posts.filter(p => p.author === "[deleted]").length;
  const lockedPosts = posts.filter(p => p.locked).length;
  const over18 = posts.filter(p => p.over_18).length;
  const stickied = posts.filter(p => p.stickied).length;
  const removedByCategory = {};
  for (const p of posts) {
    if (p.removed_by_category) removedByCategory[p.removed_by_category] = (removedByCategory[p.removed_by_category] || 0) + 1;
  }

  // Flair distribution (shows how posts are categorized by mods/users)
  const flairs = {};
  for (const p of posts) {
    const f = p.link_flair_text || "Unflaired";
    flairs[f] = (flairs[f] || 0) + 1;
  }
  const flairDist = Object.entries(flairs).sort((a, b) => b[1] - a[1]);

  // Comment-level: deleted authors (proxy for removed/banned users)
  let deletedCommentAuthors = 0;
  for (const p of posts) {
    for (const c of (p.comments || [])) {
      totalComments++;
      if (c.author === "[deleted]") deletedCommentAuthors++;
    }
  }

  // Upvote ratio distribution (low ratio = controversial/downvoted)
  const ratios = posts.map(p => p.upvote_ratio).filter(r => r !== undefined && r !== null);
  const avgUpvoteRatio = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  const lowRatio = ratios.filter(r => r < 0.5).length;
  const highRatio = ratios.filter(r => r > 0.9).length;

  // Controversial posts: high engagement, low upvote ratio
  const controversial = posts
    .filter(p => (p.num_comments || 0) > 30 && (p.upvote_ratio || 1) < 0.7)
    .map(p => ({
      title: p.title.slice(0, 120),
      score: p.score || 0,
      comments: p.num_comments || 0,
      upvoteRatio: p.upvote_ratio || 0,
      flair: p.link_flair_text || "none",
    }))
    .sort((a, b) => a.upvoteRatio - b.upvoteRatio)
    .slice(0, 10);

  // Low-quality signals: "Slop", "Misleading", "AI Written", "Unverified Claim" flairs
  const lowQualityFlairs = ["Slop", "Misleading", "AI Written", "Unverified Claim"];
  const flagged = posts.filter(p => lowQualityFlairs.includes(p.link_flair_text)).length;

  // Monthly moderation metrics
  const byMonth = {};
  for (const p of posts) {
    const mk = monthKey(p.created_utc);
    if (!byMonth[mk]) byMonth[mk] = { posts: 0, deleted: 0, locked: 0, controversial: 0, flagged: 0, lowRatio: 0 };
    byMonth[mk].posts++;
    if (p.author === "[deleted]") byMonth[mk].deleted++;
    if (p.locked) byMonth[mk].locked++;
    if ((p.num_comments || 0) > 30 && (p.upvote_ratio || 1) < 0.7) byMonth[mk].controversial++;
    if (lowQualityFlairs.includes(p.link_flair_text)) byMonth[mk].flagged++;
    if ((p.upvote_ratio || 1) < 0.5) byMonth[mk].lowRatio++;
  }
  const monthlyMod = Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, d]) => ({
      month,
      ...d,
      deletedPct: d.posts > 0 ? (d.deleted / d.posts) * 100 : 0,
      controversialPct: d.posts > 0 ? (d.controversial / d.posts) * 100 : 0,
      flaggedPct: d.posts > 0 ? (d.flagged / d.posts) * 100 : 0,
      lowRatioPct: d.posts > 0 ? (d.lowRatio / d.posts) * 100 : 0,
    }));

  // Overall moderation score (heuristic)
  // Higher = better moderation. Factors: low deleted %, low controversial %, low flagged %, high avg upvote ratio
  const deletedPct = total > 0 ? (deletedAuthors / total) * 100 : 0;
  const controversialPct = total > 0 ? (controversial.length / total) * 100 : 0;
  const flaggedPct = total > 0 ? (flagged / total) * 100 : 0;
  const lowRatioPct = total > 0 ? (lowRatio / total) * 100 : 0;
  const modScore = Math.max(0, Math.round(100 - deletedPct * 2 - controversialPct * 1.5 - flaggedPct * 3 - lowRatioPct * 0.5));

  return {
    totalPosts: total,
    totalComments,
    deletedAuthors,
    deletedCommentAuthors,
    lockedPosts,
    over18,
    stickied,
    removedByCategory,
    flairDist,
    flagged,
    avgUpvoteRatio,
    lowRatio,
    highRatio,
    controversial,
    deletedPct,
    controversialPct,
    flaggedPct,
    lowRatioPct,
    modScore,
    monthlyMod,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(STORAGE_FILE)) {
    console.error(`No data found at ${STORAGE_FILE}. Run ingest first.`);
    process.exit(1);
  }

  const storage = JSON.parse(readFileSync(STORAGE_FILE, "utf8"));
  const allPosts = storage.posts;
  const globalNow = Math.max(...allPosts.map(p => p.created_utc));
  let posts = allPosts;
  if (PERIOD_DAYS) {
    const cutoff = globalNow - PERIOD_DAYS * 86400;
    posts = posts.filter(p => p.created_utc >= cutoff);
    console.log(`\n  Reddit Memory Analysis — r/${SUBREDDIT} (last ${PERIOD_DAYS} days)`);
  } else {
    console.log(`\n  Reddit Memory Analysis — r/${SUBREDDIT}`);
  }
  console.log(`  ${posts.length} posts, ${posts.reduce((s, p) => s + (p.comments?.length || 0), 0)} comments\n`);

  // Build text corpus: post titles + selftext + comment bodies
  const allTexts = [];
  const textMeta = []; // {type, postId, date, score}
  for (const post of posts) {
    if (post.title) {
      allTexts.push(post.title);
      textMeta.push({ type: "post", postId: post.id, date: post.created_utc, score: post.score || 0 });
    }
    if (post.selftext && post.selftext.length > 20) {
      allTexts.push(post.selftext.slice(0, 2000));
      textMeta.push({ type: "selftext", postId: post.id, date: post.created_utc, score: post.score || 0 });
    }
    for (const c of (post.comments || [])) {
      if (c.body && c.body.length > 10) {
        allTexts.push(c.body.slice(0, 1000));
        textMeta.push({ type: "comment", postId: post.id, date: c.created_utc, score: c.score || 0 });
      }
    }
  }

  console.log(`  ${allTexts.length} texts to embed (${textMeta.filter(m => m.type === "comment").length} comments)`);
  const embeddings = await embed(allTexts);

  // 1. Recurring questions (filtered)
  console.log("\n  [1] Recurring questions...");
  const questions = findRecurringQuestions(allTexts, embeddings, 0.75);
  console.log(`    ${questions.length} recurring question groups`);

  // 2. Topic clusters
  console.log("  [2] Topic clusters...");
  const topics = await clusterTopics(allTexts, embeddings);
  console.log(`    ${topics.length} clusters`);

  // 3. Tone (posts + comments separately)
  console.log("  [3] Tone & emotion...");
  const postTexts = allTexts.filter((_, i) => textMeta[i].type !== "comment");
  const commentTexts = allTexts.filter((_, i) => textMeta[i].type === "comment");
  const postTone = analyzeTone(postTexts);
  const commentTone = analyzeTone(commentTexts);
  console.log(`    posts: ${postTone.pos}+/${postTone.neu}n/${postTone.neg}- | comments: ${commentTone.pos}+/${commentTone.neu}n/${commentTone.neg}-`);

  // 4. Comment grouping for top recurring questions
  console.log("  [4] Comment grouping per question...");
  const questionGroups = [];
  for (const q of questions.slice(0, 5)) {
    // Find posts related to this question
    const qEmbed = embeddings[allTexts.indexOf(q.question)]; // approximate
    // Actually, find the post indices for this question group
    // For now, group comments from posts whose title matches the question cluster
    const relatedComments = [];
    for (const inst of q.instances) {
      // Find the post for this instance
      const textIdx = allTexts.indexOf(inst.text);
      if (textIdx >= 0) {
        const meta = textMeta[textIdx];
        const post = posts.find(p => p.id === meta.postId);
        if (post?.comments) {
          for (const c of post.comments) {
            if (c.body && c.body.length > 10) relatedComments.push(c);
          }
        }
      }
    }
    if (relatedComments.length >= 2) {
      const commentEmbeds = await embed(relatedComments.map(c => c.body.slice(0, 500)));
      const groups = groupComments(relatedComments, commentEmbeds, 0.45);
      // Show top groups with more than 1 comment, plus a "other" bucket
      const significant = groups.filter(g => g.count >= 2);
      const singletons = groups.filter(g => g.count === 1);
      const displayGroups = significant.slice(0, 8);
      if (singletons.length > 0) {
        displayGroups.push({
          groupId: -1,
          members: singletons.flatMap(g => g.members),
          avgScore: singletons.reduce((s, g) => s + g.avgScore * g.count, 0) / singletons.reduce((s, g) => s + g.count, 0),
          representative: `[${singletons.length} unique answers]`,
          count: singletons.reduce((s, g) => s + g.count, 0),
        });
      }
      questionGroups.push({ question: q.question, count: q.count, commentGroups: displayGroups, totalComments: relatedComments.length });
      console.log(`    "${q.question.slice(0, 50)}..." → ${groups.length} clusters, ${significant.length} multi-comment groups, ${singletons.length} singletons from ${relatedComments.length} comments`);
    }
  }

  // 5. Per-post topic assignment + monthly breakdown for charts
  console.log("  [5] Per-post topic assignment...");
  const postTopics = await assignPostTopics(posts);

  // Compute time-bucketed data at multiple granularities so the UI can pick the right one
  const topicBreakdown = topicBreakdownForBuckets(posts, postTopics, monthKey, k => k);
  const toneTrajectory = toneTrajectoryForBuckets(posts, monthKey, k => k);
  const topicBreakdownWeekly = topicBreakdownForBuckets(posts, postTopics, weekKey, k => k);
  const toneTrajectoryWeekly = toneTrajectoryForBuckets(posts, weekKey, k => k);
  const topicBreakdownDaily = topicBreakdownForBuckets(posts, postTopics, dayKey, k => k);
  const toneTrajectoryDaily = toneTrajectoryForBuckets(posts, dayKey, k => k);
  console.log(`    monthly: ${topicBreakdown.buckets.length} buckets, weekly: ${topicBreakdownWeekly.buckets.length}, daily: ${topicBreakdownDaily.buckets.length}, ${topicBreakdown.topics.length} topics`);

  // 5b. Evolution (community phases + topic emergence)
  console.log("  [5b] Evolution (phases + topic emergence)...");
  const evolution = analyzeEvolution(posts, null, topicBreakdown);
  if (evolution.phases) {
    console.log(`    ${evolution.phases.length} phases detected, ${evolution.topicEmergence?.length || 0} topics tracked, ${evolution.keyShifts?.length || 0} key shifts`);
  }

  // 6. Community health
  console.log("  [6] Community health...");
  const health = analyzeHealth(posts);
  console.log(`    answer rate: ${health.answerRate.toFixed(1)}%, avg comments/post: ${health.avgCommentsPerPost.toFixed(1)}`);

  // 7. Moderation
  console.log("  [7] Moderation...");
  const moderation = analyzeModeration(posts);
  console.log(`    mod score: ${moderation.modScore}/100, deleted: ${moderation.deletedPct.toFixed(1)}%, controversial: ${moderation.controversialPct.toFixed(1)}%, flagged: ${moderation.flaggedPct.toFixed(1)}%`);

  // 8. Engagement scatter data (score vs comments per post, with topic)
  console.log("  [8] Engagement scatter data...");
  const engagementScatter = posts.map((p, i) => ({
    id: p.id || "",
    permalink: p.permalink || "",
    score: p.score || 0,
    comments: p.num_comments || p.comments?.length || 0,
    upvoteRatio: p.upvote_ratio || 1,
    topic: postTopics[i] || 0,
    flair: p.link_flair_text || "none",
    title: (p.title || "").slice(0, 100),
    text: `${p.title || ""} ${p.selftext || ""}`.trim().slice(0, 2000),
    created: p.created_utc,
    date: new Date(p.created_utc * 1000).toISOString().slice(0, 10),
  }));

  // 9. Score distribution histogram (log-scale bins for power-law data)
  const allScores = posts.map(p => p.score || 0).sort((a, b) => a - b);
  const maxScore = allScores[allScores.length - 1] || 1;
  const scoreHistogram = [];
  // Log bins: 0, 1-9, 10-99, 100-999, 1000-9999, etc.
  const logBins = [
    { lo: 0, hi: 1, label: "0" },
    { lo: 1, hi: 10, label: "1-9" },
    { lo: 10, hi: 50, label: "10-49" },
    { lo: 50, hi: 100, label: "50-99" },
    { lo: 100, hi: 500, label: "100-499" },
    { lo: 500, hi: 1000, label: "500-999" },
    { lo: 1000, hi: 2000, label: "1k-2k" },
    { lo: 2000, hi: 5000, label: "2k-5k" },
    { lo: 5000, hi: 10000, label: "5k-10k" },
  ];
  for (const bin of logBins) {
    const count = allScores.filter(s => s >= bin.lo && s < bin.hi).length;
    scoreHistogram.push({ range: bin.label, count, lo: bin.lo, hi: bin.hi });
  }

  // 10. Activity heatmap (day-of-week × hour-of-day)
  console.log("  [10] Activity heatmap data...");
  const activityGrid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const p of posts) {
    const d = new Date(p.created_utc * 1000);
    activityGrid[d.getDay()][d.getHours()]++;
  }

  // 11. Top posts leaderboard
  console.log("  [11] Top posts leaderboard...");
  const topPosts = [...posts]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 20)
    .map(p => ({
      title: (p.title || "").slice(0, 120),
      score: p.score || 0,
      comments: p.num_comments || p.comments?.length || 0,
      upvoteRatio: p.upvote_ratio || 1,
      flair: p.link_flair_text || "none",
      author: p.author || "[deleted]",
      date: new Date(p.created_utc * 1000).toISOString().slice(0, 10),
      permalink: p.permalink || "",
    }));

  // Also most commented
  const mostCommented = [...posts]
    .sort((a, b) => (b.num_comments || b.comments?.length || 0) - (a.num_comments || a.comments?.length || 0))
    .slice(0, 10)
    .map(p => ({
      title: (p.title || "").slice(0, 120),
      score: p.score || 0,
      comments: p.num_comments || p.comments?.length || 0,
      upvoteRatio: p.upvote_ratio || 1,
      flair: p.link_flair_text || "none",
      author: p.author || "[deleted]",
      date: new Date(p.created_utc * 1000).toISOString().slice(0, 10),
    }));

  // 12. Top contributors (with avg score)
  console.log("  [12] Top contributors...");
  const authorStats = {};
  for (const p of posts) {
    const a = p.author || "[deleted]";
    if (!authorStats[a]) authorStats[a] = { posts: 0, totalScore: 0, totalComments: 0 };
    authorStats[a].posts++;
    authorStats[a].totalScore += p.score || 0;
    authorStats[a].totalComments += p.num_comments || p.comments?.length || 0;
  }
  const topContributors = Object.entries(authorStats)
    .filter(([a]) => a !== "[deleted]")
    .map(([author, s]) => ({
      author,
      posts: s.posts,
      avgScore: Math.round(s.totalScore / s.posts),
      totalScore: s.totalScore,
      totalComments: s.totalComments,
    }))
    .sort((a, b) => b.posts - a.posts)
    .slice(0, 15);

  // 13. Period comparisons (7d, 30d, 365d vs previous period)
  console.log("  [13] Period comparisons...");
  const now = globalNow;
  const daySec = 86400;

  function periodStats(postsInPeriod) {
    if (postsInPeriod.length === 0) return { posts: 0, comments: 0, avgScore: 0, avgComments: 0, posPct: 0, neuPct: 0, negPct: 0, controversial: 0, deleted: 0 };
    const totalComments = postsInPeriod.reduce((s, p) => s + (p.num_comments || p.comments?.length || 0), 0);
    const totalScore = postsInPeriod.reduce((s, p) => s + (p.score || 0), 0);
    const tone = analyzeTone(postsInPeriod.map(p => p.title + " " + (p.selftext || "")));
    const total = postsInPeriod.length;
    const controversial = postsInPeriod.filter(p => (p.num_comments || p.comments?.length || 0) >= 30 && (p.upvote_ratio || 1) < 0.7).length;
    const deleted = postsInPeriod.filter(p => p.author === "[deleted]").length;
    return {
      posts: total,
      comments: totalComments,
      avgScore: Math.round(totalScore / total),
      avgComments: +(totalComments / total).toFixed(1),
      posPct: +((tone.pos / total) * 100).toFixed(1),
      neuPct: +((tone.neu / total) * 100).toFixed(1),
      negPct: +((tone.neg / total) * 100).toFixed(1),
      controversial,
      deleted,
    };
  }

  function periodComparison(days) {
    const cutoff = now - days * daySec;
    const prevCutoff = now - 2 * days * daySec;
    const recent = posts.filter(p => p.created_utc >= cutoff);
    const previous = posts.filter(p => p.created_utc >= prevCutoff && p.created_utc < cutoff);
    const recentStats = periodStats(recent);
    const prevStats = periodStats(previous);
    const deltas = {};
    for (const key of ["posts", "comments", "avgScore", "avgComments", "posPct", "negPct", "controversial", "deleted"]) {
      deltas[key] = recentStats[key] - prevStats[key];
    }
    return { days, recent: recentStats, previous: prevStats, deltas };
  }

  const periodComparisons = [
    periodComparison(7),
    periodComparison(30),
    periodComparison(365),
  ];

  // 14. Weekly time series (posts, comments, avg score, tone per week)
  console.log("  [14] Weekly time series...");
  const weeklyData = [];
  const firstPost = Math.min(...posts.map(p => p.created_utc));
  const periodNow = Math.max(...posts.map(p => p.created_utc));
  const totalWeeks = Math.ceil((periodNow - firstPost) / (7 * daySec));
  for (let w = 0; w < totalWeeks; w++) {
    const weekStart = firstPost + w * 7 * daySec;
    const weekEnd = weekStart + 7 * daySec;
    const weekPosts = posts.filter(p => p.created_utc >= weekStart && p.created_utc < weekEnd);
    if (weekPosts.length === 0) continue;
    const ws = periodStats(weekPosts);
    weeklyData.push({
      week: w,
      weekStart: new Date(weekStart * 1000).toISOString().slice(0, 10),
      weekEnd: new Date((weekEnd - daySec) * 1000).toISOString().slice(0, 10),
      label: new Date(weekStart * 1000).toISOString().slice(0, 10),
      ...ws,
    });
  }

  // 15. Last 7 days daily breakdown
  console.log("  [15] Daily breakdown (last 7 days)...");
  const dailyData = [];
  for (let d = 6; d >= 0; d--) {
    const dayStart = periodNow - (d + 1) * daySec;
    const dayEnd = periodNow - d * daySec;
    const dayPosts = posts.filter(p => p.created_utc >= dayStart && p.created_utc < dayEnd);
    const ds = periodStats(dayPosts);
    dailyData.push({
      date: new Date(dayStart * 1000).toISOString().slice(0, 10),
      dayName: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(dayStart * 1000).getDay()],
      ...ds,
    });
  }

  // ─── Output ─────────────────────────────────────────────────────────────
  const report = {
    subreddit: SUBREDDIT,
    generatedAt: new Date().toISOString(),
    totals: {
      posts: posts.length,
      comments: health.totalComments,
      texts: allTexts.length,
      dateRange: {
        start: new Date(Math.min(...posts.map(p => p.created_utc * 1000))).toISOString().slice(0, 10),
        end: new Date(Math.max(...posts.map(p => p.created_utc * 1000))).toISOString().slice(0, 10),
      },
    },
    recurringQuestions: questions,
    topics,
    tone: { posts: postTone, comments: commentTone },
    questionGroups,
    evolution,
    topicBreakdown,
    toneTrajectory,
    topicBreakdownWeekly,
    toneTrajectoryWeekly,
    topicBreakdownDaily,
    toneTrajectoryDaily,
    health,
    moderation,
    engagementScatter,
    scoreHistogram,
    activityGrid,
    topPosts,
    mostCommented,
    topContributors,
    periodComparisons,
    weeklyData,
    dailyData,
  };

  // Save report
  const suffix = PERIOD_DAYS ? `-${PERIOD_DAYS}d` : "";
  const reportFile = join(process.cwd(), "data", "reddit-memory", `${SUBREDDIT}-report${suffix}.json`);
  const { writeFileSync } = await import("node:fs");
  const { mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  const dir = dirname(reportFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\n  Report saved to ${reportFile}\n`);

  // Print summary
  printSummary(report);

  // Save embedding cache
  saveCache();
}

function pct(n, t) { return t > 0 ? ((n / t) * 100).toFixed(1) + "%" : "0%"; }

function printSummary(r) {
  console.log("  " + "═".repeat(68));
  console.log(`  REPORT: r/${r.subreddit}`);
  console.log("  " + "═".repeat(68));

  console.log(`\n  Totals: ${r.totals.posts} posts, ${r.totals.comments} comments, ${r.totals.texts} texts`);
  console.log(`  Date: ${r.totals.dateRange.start} → ${r.totals.dateRange.end}`);

  console.log(`\n  ── Recurring Questions (${r.recurringQuestions.length}) ──`);
  for (const q of r.recurringQuestions.slice(0, 8)) {
    console.log(`    [${q.count}x, sim ${q.avgSim.toFixed(3)}] ${q.question.slice(0, 80)}`);
  }

  console.log(`\n  ── Topics ──`);
  for (const t of r.topics.slice(0, 6)) {
    console.log(`    ${t.label}: ${t.count} texts (sim ${t.avgSim.toFixed(3)})`);
  }

  console.log(`\n  ── Tone ──`);
  console.log(`    Posts:    ${pct(r.tone.posts.pos, r.tone.posts.total)}+ / ${pct(r.tone.posts.neu, r.tone.posts.total)}n / ${pct(r.tone.posts.neg, r.tone.posts.total)}-`);
  console.log(`    Comments: ${pct(r.tone.comments.pos, r.tone.comments.total)}+ / ${pct(r.tone.comments.neu, r.tone.comments.total)}n / ${pct(r.tone.comments.neg, r.tone.comments.total)}-`);

  console.log(`\n  ── Comment Groups per Question ──`);
  for (const qg of r.questionGroups.slice(0, 3)) {
    console.log(`    "${qg.question.slice(0, 60)}..." (${qg.totalComments} comments, ${qg.commentGroups.length} groups)`);
    for (const g of qg.commentGroups.slice(0, 2)) {
      console.log(`      [${g.count} comments, avg score ${g.avgScore.toFixed(0)}] ${g.representative.slice(0, 80)}`);
    }
  }

  console.log(`\n  ── Evolution (Community Phases) ──`);
  if (r.evolution.note) {
    console.log(`    ${r.evolution.note}`);
  } else if (r.evolution.phases) {
    console.log(`    Analyzed ${r.evolution.analyzedMonths} of ${r.evolution.totalMonths} months (20+ posts each)`);
    console.log(`\n    Phases (by dominant topic):`);
    for (const p of r.evolution.phases) {
      console.log(`      ${p.period}: ${p.dominantTopic} (${p.dominantPct}% of ${p.totalPosts} posts, ${p.monthCount} months)`);
    }
    console.log(`\n    Topic emergence & trends:`);
    for (const t of r.evolution.topicEmergence) {
      const arrow = t.trend === "growing" ? "↑" : t.trend === "declining" ? "↓" : "→";
      console.log(`      ${arrow} ${t.topic}: first seen ${t.firstMonth || "?"}, peaked ${t.peakMonth} (${t.peakCount} posts), ${t.trend}`);
    }
    if (r.evolution.keyShifts?.length > 0) {
      console.log(`\n    Key shifts (topic crossovers):`);
      for (const s of r.evolution.keyShifts.slice(0, 5)) {
        console.log(`      ${s.month}: ${s.from} → ${s.to} took over`);
      }
    }
  }

  console.log(`\n  ── Community Health ──`);
  console.log(`    Answer rate: ${r.health.answerRate.toFixed(1)}%`);
  console.log(`    Avg comments/post: ${r.health.avgCommentsPerPost.toFixed(1)}`);
  console.log(`    Median post score: ${r.health.medianScore}`);
  if (r.health.topAuthors.length > 0) {
    console.log(`    Top contributors: ${r.health.topAuthors.map(([a, c]) => `${a} (${c})`).join(", ")}`);
  }

  if (r.moderation) {
    console.log(`\n  ── Moderation ──`);
    console.log(`    Mod score: ${r.moderation.modScore}/100`);
    console.log(`    Deleted authors: ${r.moderation.deletedAuthors} (${r.moderation.deletedPct.toFixed(1)}% of posts)`);
    console.log(`    Deleted comment authors: ${r.moderation.deletedCommentAuthors} (${((r.moderation.deletedCommentAuthors / r.moderation.totalComments) * 100).toFixed(1)}% of comments)`);
    console.log(`    Locked posts: ${r.moderation.lockedPosts}`);
    console.log(`    NSFW posts: ${r.moderation.over18}`);
    console.log(`    Flagged (slop/misleading/AI): ${r.moderation.flagged} (${r.moderation.flaggedPct.toFixed(1)}%)`);
    console.log(`    Controversial (30+ comments, <70% upvote): ${r.moderation.controversial.length} (${r.moderation.controversialPct.toFixed(1)}%)`);
    console.log(`    Avg upvote ratio: ${(r.moderation.avgUpvoteRatio * 100).toFixed(1)}%`);
    console.log(`    Low upvote ratio (<50%): ${r.moderation.lowRatio} (${r.moderation.lowRatioPct.toFixed(1)}%)`);
    console.log(`    Flair distribution:`);
    for (const [flair, count] of r.moderation.flairDist.slice(0, 8)) {
      console.log(`      ${flair}: ${count} (${((count / r.moderation.totalPosts) * 100).toFixed(1)}%)`);
    }
    if (r.moderation.controversial.length > 0) {
      console.log(`    Most controversial posts:`);
      for (const c of r.moderation.controversial.slice(0, 3)) {
        console.log(`      [${c.score} pts, ${c.comments} comments, ${(c.upvoteRatio * 100).toFixed(0)}% upvote, ${c.flair}] ${c.title.slice(0, 70)}`);
      }
    }
  }

  console.log("\n  " + "═".repeat(68) + "\n");
}

main().catch(err => { console.error("\nFailed:", err.message); process.exit(1); });
