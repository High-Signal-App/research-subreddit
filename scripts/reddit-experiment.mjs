/**
 * Reddit Memory Experiment (RSS-based)
 *
 * Pulls posts from a subreddit's RSS feed (the .json endpoints return 403
 * from residential IPs — same finding as high-signal's Python adapter),
 * maps them to the engine's data shape, runs the same embedding model
 * (all-MiniLM-L6-v2) + clustering + tone analysis, and prints a report.
 *
 * Usage: node scripts/reddit-experiment.mjs <subreddit> [feed-type]
 *   feed-type: hot | new | top  (default: hot)
 */

import { pipeline } from "@huggingface/transformers";

const SUBREDDIT = process.argv[2] || "LocalLLaMA";
const FEED_TYPE = process.argv[3] || "hot";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const RSS_DELAY_MS = 6500; // ~9 req/min to stay under Reddit's ~10/min anonymous limit

// ─── RSS fetching + parsing ───────────────────────────────────────────────

async function fetchRss(sub, feedType) {
  let path;
  if (feedType === "hot") path = `/r/${encodeURIComponent(sub)}/.rss`;
  else if (feedType === "new") path = `/r/${encodeURIComponent(sub)}/new/.rss`;
  else if (feedType === "top") path = `/r/${encodeURIComponent(sub)}/top/.rss?t=month`;
  else path = `/r/${encodeURIComponent(sub)}/.rss`;

  const url = `https://www.reddit.com${path}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
      },
    });
    if (res.status === 429) {
      const reset = parseInt(res.headers.get("x-ratelimit-reset") || "30", 10);
      console.error(`  429 rate-limited, waiting ${reset + 2}s (attempt ${attempt + 1}/3)`);
      await sleep((reset + 2) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`reddit ${res.status} on ${path}`);
    return await res.text();
  }
  throw new Error(`reddit rate-limited after 3 attempts on ${path}`);
}

function parseAtomFeed(xml) {
  const entries = [];
  // Match <entry>...</entry> blocks
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const published = extractTag(block, "published");
    const updated = extractTag(block, "updated");
    const id = extractTag(block, "id");
    const author = extractTag(block, "name");
    const link = extractAttr(block, "link", "href");
    const contentHtml = extractTagContent(block, "content");

    // Extract selftext from the HTML content (between SC_OFF and SC_ON markers).
    // In the RSS feed, these markers are HTML-encoded as &lt;!-- SC_OFF --&gt;
    const decodedContent = decodeHtml(contentHtml);
    let selftext = "";
    const scMatch = decodedContent.match(/<!-- SC_OFF -->([\s\S]*?)<!-- SC_ON -->/);
    if (scMatch) {
      selftext = stripHtml(scMatch[1]).trim();
    }

    // Extract permalink from link or id
    const permalink = link || id.replace("t3_", "https://www.reddit.com/r/");

    entries.push({
      id: id.replace("t3_", ""),
      title,
      selftext,
      author: author.replace("/u/", ""),
      published: published || updated,
      permalink,
      contentHtml,
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
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#32;/g, " ");
}

function stripHtml(html) {
  return decodeHtml(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

// ─── Data mapping: Reddit post → ConversationRecord ───────────────────────

function mapToConversationRecords(posts) {
  return posts.map((post) => {
    const date = new Date(post.published).getTime();
    const title = post.title;
    const selftext = post.selftext;

    const prompts = [];
    if (title) {
      prompts.push({
        id: `${post.id}-title`,
        text: title,
        conversationId: post.id,
        title,
        date,
      });
    }
    if (selftext && selftext.length > 20) {
      prompts.push({
        id: `${post.id}-body`,
        text: selftext.slice(0, 2000),
        conversationId: post.id,
        title,
        date,
      });
    }

    return {
      conversationId: post.id,
      title,
      date,
      updatedAt: date,
      model: "reddit",
      messageCount: prompts.length,
      userMessageCount: prompts.length,
      assistantMessageCount: 0,
      wordCount: prompts.reduce((sum, p) => sum + p.text.split(/\s+/).length, 0),
      prompts,
      author: post.author,
      permalink: post.permalink,
    };
  });
}

// ─── Embedding + clustering ───────────────────────────────────────────────

async function embedTexts(texts, label = "texts") {
  console.log(`  loading model Xenova/all-MiniLM-L6-v2...`);
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    dtype: "q8",
  });

  const embeddings = [];
  const BATCH = 16;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    for (let j = 0; j < batch.length; j++) {
      embeddings.push(Float32Array.from(output[j].data));
    }
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

// ─── Semantic repeats (recurring questions) ───────────────────────────────

function findSemanticRepeats(texts, embeddings, threshold = 0.72) {
  const groups = [];
  const used = new Set();

  for (let i = 0; i < texts.length; i++) {
    if (used.has(i)) continue;
    const cluster = [i];
    used.add(i);
    for (let j = i + 1; j < texts.length; j++) {
      if (used.has(j)) continue;
      const sim = cosineSim(embeddings[i], embeddings[j]);
      if (sim >= threshold) {
        cluster.push(j);
        used.add(j);
      }
    }
    if (cluster.length >= 2) {
      groups.push({
        representative: texts[i].slice(0, 150),
        count: cluster.length,
        avgSimilarity:
          cluster.reduce((sum, idx) => (idx === i ? sum : sum + cosineSim(embeddings[i], embeddings[idx])), 0) /
          (cluster.length - 1),
        texts: cluster.map((idx) => texts[idx].slice(0, 120)),
      });
    }
  }
  return groups.sort((a, b) => b.count - a.count);
}

// ─── Topic clustering (anchor-based, same as engine) ──────────────────────

const TOPIC_ANCHORS = [
  ["Local LLM setup/run", "local llm running setup hardware gpu cpu inference ollama llama.cpp vllm server deploy"],
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
  const anchorTexts = TOPIC_ANCHORS.map(([, text]) => text);
  const anchorEmbeds = await embedTexts(anchorTexts, "anchors");

  const assignments = embeddings.map((emb) => {
    let bestIdx = 0;
    let bestSim = -1;
    for (let a = 0; a < anchorEmbeds.length; a++) {
      const sim = cosineSim(emb, anchorEmbeds[a]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = a;
      }
    }
    return { topicIdx: bestIdx, similarity: bestSim };
  });

  return TOPIC_ANCHORS.map(([label], idx) => {
    const members = assignments.map((a, i) => ({ ...a, i })).filter((a) => a.topicIdx === idx);
    return {
      label,
      count: members.length,
      avgSimilarity: members.reduce((s, a) => s + a.similarity, 0) / Math.max(1, members.length),
      examples: members.map((m) => texts[m.i].slice(0, 100)).slice(0, 4),
    };
  })
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);
}

// ─── Tone / emotion (lexical, same as insights.ts) ────────────────────────

const POSITIVE_WORDS = new Set("awesome best better great good happy helpful love nice perfect progress proud useful win wonderful excited amazing".split(" "));
const NEGATIVE_WORDS = new Set("angry annoyed anxious awful bad broken confused difficult disappointed error fail failed failing frustrated hate hard horrible issue problem sad stuck terrible useless worse worst wrong".split(" "));
const EMOTION_PATTERNS = {
  curiosity: [/\b(?:why|how|what|wonder|curious|explain|understand|learn|explore|discover)\b/i],
  frustration: [/\b(?:stuck|broken|fail(?:ed|ing)?|error|annoyed|frustrat(?:ed|ing)|hate|wrong|useless|doesn'?t work|not working)\b/i],
  urgency: [/\b(?:urgent|asap|quickly|right now|immediately|deadline|hurry)\b/i],
  uncertainty: [/\b(?:unsure|maybe|might|could|perhaps|confused|not sure|uncertain)\b/i],
  excitement: [/\b(?:excited|amazing|awesome|love|can'?t wait|great|wonderful|super)\b/i],
  appreciation: [/\b(?:thanks|thank you|appreciate|helpful|grateful)\b/i],
};

function analyzeTone(texts) {
  let positive = 0, neutral = 0, negative = 0;
  const emotions = { curiosity: 0, frustration: 0, urgency: 0, uncertainty: 0, excitement: 0, appreciation: 0, neutral: 0 };
  for (const text of texts) {
    const words = text.toLowerCase().split(/\s+/);
    let pos = 0, neg = 0;
    for (const w of words) {
      if (POSITIVE_WORDS.has(w)) pos++;
      if (NEGATIVE_WORDS.has(w)) neg++;
    }
    if (pos > neg) positive++;
    else if (neg > pos) negative++;
    else neutral++;
    let found = false;
    for (const [emotion, patterns] of Object.entries(EMOTION_PATTERNS)) {
      if (patterns.some((p) => p.test(text))) { emotions[emotion]++; found = true; break; }
    }
    if (!found) emotions.neutral++;
  }
  return { positive, neutral, negative, emotions, total: texts.length };
}

// ─── Evolution (month-over-month centroid drift) ──────────────────────────

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
  if (months.length < 2) return { months, note: "Only one month in data — need multiple months for evolution analysis" };

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
    drift.push({
      from: centroids[i - 1].month,
      to: centroids[i].month,
      centroidSimilarity: sim,
      drift: sim < 0.82 ? "significant" : sim < 0.90 ? "moderate" : "minimal",
    });
  }

  // Per-month topic distribution
  const monthlyTopics = months.map((mk) => {
    const items = byMonth.get(mk);
    return {
      month: mk,
      postCount: items.length,
      topTitles: items.map((it) => it.rec.title.slice(0, 70)).slice(0, 5),
    };
  });

  return { months, drift, monthlyTopics };
}

// ─── Utilities ────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function pct(n, total) { return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "0%"; }

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  Reddit Memory Experiment (RSS)                               ║`);
  console.log(`║  r/${SUBREDDIT.padEnd(54)}║`);
  console.log(`║  feed: ${FEED_TYPE.padEnd(54)}║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

  // 1. Fetch RSS — try multiple feeds to get more data for the experiment
  console.log(`[1/4] Fetching RSS feeds for r/${SUBREDDIT}...`);
  const feedTypes = FEED_TYPE === "all" ? ["hot", "new", "top"] : [FEED_TYPE];
  let posts = [];
  const seenIds = new Set();
  for (const ft of feedTypes) {
    console.log(`  fetching ${ft} feed...`);
    const xml = await fetchRss(SUBREDDIT, ft);
    const feedPosts = parseAtomFeed(xml);
    for (const p of feedPosts) {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        posts.push(p);
      }
    }
    console.log(`    ${feedPosts.length} posts (${posts.length} unique total)`);
    if (feedTypes.indexOf(ft) < feedTypes.length - 1) await sleep(7000);
  }
  console.log(`  parsed ${posts.length} unique posts from ${feedTypes.length} feeds`);

  // 2. Map to engine format
  const records = mapToConversationRecords(posts);
  const allPrompts = records.flatMap((r) => r.prompts);
  const allTexts = allPrompts.map((p) => p.text);
  console.log(`\n[2/4] Mapped to ${records.length} posts, ${allPrompts.length} texts (title + selftext)`);

  // 3. Embed
  console.log(`\n[3/4] Embedding ${allTexts.length} texts...`);
  const t0 = Date.now();
  const embeddings = await embedTexts(allTexts, "texts");
  const embedMs = Date.now() - t0;
  console.log(`  done in ${(embedMs / 1000).toFixed(1)}s`);

  // 4. Analyze
  console.log(`\n[4/4] Running analysis...\n`);
  const repeats = findSemanticRepeats(allTexts, embeddings, 0.72);
  const topics = await clusterTopics(allTexts, embeddings);
  const tone = analyzeTone(allTexts);

  // Evolution: embed post titles only
  const postTitles = records.map((r) => r.title);
  console.log(`  embedding ${postTitles.length} post titles for evolution...`);
  const postEmbeds = await embedTexts(postTitles, "titles");
  const evolution = analyzeEvolution(records, postEmbeds);

  // ─── Report ─────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  EXPERIMENT REPORT: r/${SUBREDDIT} (${FEED_TYPE} feed)`);
  console.log(`${"═".repeat(70)}\n`);

  console.log(`── Totals ──`);
  console.log(`  Posts: ${posts.length}`);
  console.log(`  Texts analyzed: ${allTexts.length} (titles + selftext)`);
  console.log(`  Posts with selftext: ${posts.filter((p) => p.selftext.length > 20).length}`);
  console.log(`  Date range: ${new Date(Math.min(...records.map((r) => r.date))).toISOString().slice(0, 10)} → ${new Date(Math.max(...records.map((r) => r.date))).toISOString().slice(0, 10)}`);
  console.log(`  Embedding time: ${(embedMs / 1000).toFixed(1)}s\n`);

  console.log(`── Recurring Questions / Themes (semantic repeats, sim ≥ 0.72) ──`);
  if (repeats.length === 0) {
    console.log(`  No semantic repeats found at this threshold.`);
  } else {
    repeats.slice(0, 12).forEach((g, i) => {
      console.log(`\n  ${i + 1}. [${g.count}x, avg sim ${g.avgSimilarity.toFixed(3)}] "${g.representative}"`);
      g.texts.slice(0, 3).forEach((t) => console.log(`     → "${t}"`));
    });
  }
  console.log();

  console.log(`── Topic Clusters ──`);
  topics.forEach((t, i) => {
    console.log(`\n  ${i + 1}. ${t.label} — ${t.count} texts (avg anchor sim ${t.avgSimilarity.toFixed(3)})`);
    t.examples.forEach((ex) => console.log(`     → "${ex}"`));
  });
  console.log();

  console.log(`── Tone & Emotion ──`);
  console.log(`  Positive: ${tone.positive} (${pct(tone.positive, tone.total)})  Neutral: ${tone.neutral} (${pct(tone.neutral, tone.total)})  Negative: ${tone.negative} (${pct(tone.negative, tone.total)})`);
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
    evolution.monthlyTopics.forEach((m) => {
      console.log(`  ${m.month} (${m.postCount} posts):`);
      m.topTitles.forEach((t) => console.log(`    → "${t}"`));
    });
    console.log(`\n  Centroid drift (month-over-month):`);
    evolution.drift.forEach((d) => {
      console.log(`    ${d.from} → ${d.to}: sim=${d.centroidSimilarity.toFixed(3)} (${d.drift})`);
    });
  }
  console.log();

  // Assessment
  console.log(`${"═".repeat(70)}`);
  console.log(`  ASSESSMENT`);
  console.log(`${"═".repeat(70)}\n`);
  const hasRepeats = repeats.length > 0;
  const hasTopics = topics.filter((t) => t.count >= 2).length >= 3;
  const hasTone = tone.total > 0;
  const hasEvolution = evolution.drift && evolution.drift.length > 0;

  console.log(`  Recurring questions detected:  ${hasRepeats ? `YES (${repeats.length} groups)` : "NO"}`);
  console.log(`  Meaningful topic clusters:     ${hasTopics ? `YES (${topics.filter((t) => t.count >= 2).length} clusters with ≥2 texts)` : "NO"}`);
  console.log(`  Tone/emotion signal:           ${hasTone ? "YES" : "NO"}`);
  console.log(`  Evolution signal:              ${hasEvolution ? `YES (${evolution.drift?.length || 0} transitions)` : "NO — need multiple months"}`);
  console.log();
  const signals = [hasRepeats, hasTopics, hasTone].filter(Boolean).length;
  console.log(`  Verdict: ${signals >= 2 ? "✓ Engine produces useful signal from subreddit data" : "△ Signal quality needs more data or tuning"}`);
  console.log(`  Note: RSS feed gives ~25 hot posts (no comments). A deep pull with comments would richer signal.\n`);
}

main().catch((err) => { console.error("\nExperiment failed:", err); process.exit(1); });
