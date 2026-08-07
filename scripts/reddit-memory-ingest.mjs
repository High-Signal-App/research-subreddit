/**
 * Reddit Memory Engine — full pipeline with comments, historical storage,
 * question filtering, and comment-level analysis.
 *
 * Architecture:
 *   - Local server fetches directly from oauth.reddit.com (residential IP)
 *   - OAuth client_credentials grant (no username/password needed)
 *   - Local JSON file → historical storage (append-only, dedup by post ID)
 *   - Browser-side Transformers.js → embeddings for clustering
 *   - Question filter → separates questions from announcements
 *   - Comment grouping → semantic clusters of answers per question
 *   - Evolution tracking → how answers/topics drift over months
 *
 * Usage:
 *   node scripts/reddit-memory-ingest.mjs <subreddit> [sort] [limit] [flags...]
 *   node scripts/reddit-memory-ingest.mjs LocalLLaMA new 1000                  # posts + comments
 *   node scripts/reddit-memory-ingest.mjs LocalLLaMA new 5000 --posts-only     # posts only, deep history
 *   node scripts/reddit-memory-ingest.mjs LocalLLaMA new 1000 --months 6       # fetch 6 months back
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const SUBREDDIT = process.argv[2] || "LocalLLaMA";
const SORT = process.argv[3] || "hot";
const LIMIT = parseInt(process.argv[4] || "100", 10);
const POSTS_ONLY = process.argv.includes("--posts-only");
const MONTHS_BACK = (() => {
  const idx = process.argv.indexOf("--months");
  return idx >= 0 ? parseInt(process.argv[idx + 1], 10) : 0;
})();
const STORAGE_DIR = join(process.cwd(), "data", "reddit-memory");
const STORAGE_FILE = join(STORAGE_DIR, `${SUBREDDIT}.json`);

// ─── Reddit OAuth (client_credentials, no username/password) ──────────────

const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || "3HSxjDpyDoDePeegOw8v_w";
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || "X5B8wdAHm2Q4VyCA62uv2ScVwLPmeA";
const UA = "reddit-insights/0.1 (by /u/NexGenBot)";

let cachedToken = null;
let tokenExpiry = 0;

async function getOAuthToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const creds = btoa(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`);
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`OAuth failed: ${res.status}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function fetchReddit(path) {
  const token = await getOAuthToken();
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://oauth.reddit.com${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": UA,
      },
    });

    // Track rate limit info from headers for adaptive sleeping
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if (remaining !== null) {
      rateLimitRemaining = parseFloat(remaining);
      rateLimitReset = reset ? parseFloat(reset) : 10;
    }

    if (res.status === 429) {
      const wait = parseInt(reset || "10", 10) + 2;
      console.log(`  429, waiting ${wait}s (attempt ${attempt + 1}/3)...`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`reddit ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  }
  throw new Error("rate-limited after 3 attempts");
}

// Adaptive rate limiting: sleep less when we have budget, more when running low
let rateLimitRemaining = 100;
let rateLimitReset = 600;
async function adaptiveSleep(baseMs) {
  // If we have plenty of rate limit budget, sleep less
  if (rateLimitRemaining > 50) {
    await sleep(Math.max(200, baseMs * 0.3));
  } else if (rateLimitRemaining > 20) {
    await sleep(baseMs * 0.6);
  } else {
    // Running low — sleep the full amount or more
    const adaptiveMs = Math.max(baseMs, (rateLimitReset / Math.max(1, rateLimitRemaining)) * 1000);
    await sleep(adaptiveMs);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Fetch posts via listing pagination (capped at ~1000 items) ────────────

async function fetchPostsViaListing(sort, limit, timeParam) {
  const allPosts = [];
  let after = null;
  let page = 0;
  const pageSize = 100;

  while (allPosts.length < limit) {
    const fetchSize = Math.min(pageSize, limit - allPosts.length);
    let path;
    const timeQs = timeParam ? `&t=${timeParam}` : "";
    if (sort === "top") {
      path = `/r/${SUBREDDIT}/top.json?${timeQs ? timeQs + "&" : ""}limit=${fetchSize}${after ? `&after=${after}` : ""}`;
    } else if (sort === "new") {
      path = `/r/${SUBREDDIT}/new.json?limit=${fetchSize}${after ? `&after=${after}` : ""}`;
    } else {
      path = `/r/${SUBREDDIT}/hot.json?limit=${fetchSize}${after ? `&after=${after}` : ""}`;
    }

    process.stdout.write(`\r  ${sort}${timeParam ? "/" + timeParam : ""} page ${page + 1}: ${allPosts.length}/${limit} posts...`);
    const data = await fetchReddit(path);
    const children = data?.data?.children ?? [];
    const posts = children.map(c => c?.data).filter(d => d && d.id);

    if (posts.length === 0) {
      break;
    }

    allPosts.push(...posts);
    after = data?.data?.after;
    page++;

    if (!after) {
      break;
    }

    if (allPosts.length < limit) await adaptiveSleep(1500);
  }

  console.log(`\r  ${sort}${timeParam ? "/" + timeParam : ""}: ${allPosts.length} posts (${page} pages)                    `);
  return allPosts;
}

// ─── Deep history: combine multiple sort orders for maximum coverage ──────

async function fetchPostsDeepHistory() {
  const allPosts = [];
  const existingIds = new Set();

  const addUnique = (posts, label) => {
    let added = 0;
    for (const p of posts) {
      if (!existingIds.has(p.id)) {
        allPosts.push(p);
        existingIds.add(p.id);
        added++;
      }
    }
    console.log(`    +${added} unique (${posts.length - added} dupes)`);
    return added;
  };

  // 1. new listing (recent posts, ~1000 cap)
  console.log("  [a] new listing...");
  addUnique(await fetchPostsViaListing("new", 1000), "new");

  // 2. top/year (high-signal posts from past year)
  console.log("  [b] top/year...");
  addUnique(await fetchPostsViaListing("top", 1000, "year"), "top/year");

  // 3. top/all (all-time high-signal posts, goes back furthest)
  console.log("  [c] top/all...");
  addUnique(await fetchPostsViaListing("top", 1000, "all"), "top/all");

  return allPosts;
}

// ─── Fetch posts via timestamp search (bypasses 1000-item cap) ─────────────
// Uses cloudsearch syntax: timestamp:start..end
// Fetches in monthly chunks going backwards from now

async function fetchPostsByMonthChunk(year, month, limit = 100) {
  const start = new Date(Date.UTC(year, month - 1, 1)).getTime() / 1000;
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59)).getTime() / 1000;
  const query = `timestamp:${Math.floor(start)}..${Math.floor(end)}`;
  const params = new URLSearchParams({
    q: query,
    restrict_sr: "1",
    sort: "new",
    limit: String(limit),
    syntax: "cloudsearch",
  });

  const allPosts = [];
  let after = null;

  for (let page = 0; page < 10; page++) {
    const path = `/r/${SUBREDDIT}/search.json?${params}${after ? `&after=${after}` : ""}`;
    process.stdout.write(`\r    page ${page + 1}: ${allPosts.length} posts...`);
    const data = await fetchReddit(path);
    const children = data?.data?.children ?? [];
    const posts = children.map(c => c?.data).filter(d => d && d.id);
    if (posts.length === 0) break;
    allPosts.push(...posts);
    after = data?.data?.after;
    if (!after) break;
    await sleep(1500);
  }

  console.log(`\r    ${year}-${String(month).padStart(2, "0")}: ${allPosts.length} posts                    `);
  return allPosts;
}

async function fetchPostsHistorical(monthsBack, limit) {
  const now = new Date();
  const allPosts = [];
  const existingIds = new Set();

  for (let m = 0; m < monthsBack; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    console.log(`  Fetching ${year}-${String(month).padStart(2, "0")}...`);
    const posts = await fetchPostsByMonthChunk(year, month, 100);
    for (const p of posts) {
      if (!existingIds.has(p.id)) {
        allPosts.push(p);
        existingIds.add(p.id);
      }
    }
    if (allPosts.length >= limit) {
      console.log(`  Reached limit of ${limit}, stopping.`);
      break;
    }
    await sleep(1000);
  }

  return allPosts;
}

// ─── Fetch comments for a post ────────────────────────────────────────────

async function fetchComments(postId) {
  const path = `/r/${SUBREDDIT}/comments/${postId}.json?limit=50&sort=top&depth=2`;
  try {
    const data = await fetchReddit(path);
    const commentTree = data?.[1]?.data?.children ?? [];
    return flattenComments(commentTree, 0);
  } catch (err) {
    console.log(`    comments failed for ${postId}: ${err.message}`);
    return [];
  }
}

function flattenComments(children, depth) {
  const comments = [];
  for (const child of children) {
    const c = child?.data;
    if (!c || typeof c.body !== "string") continue;
    if (c.body === "[deleted]" || c.body === "[removed]") continue;
    if (c.body.length < 10) continue;

    comments.push({
      id: c.id,
      body: c.body,
      score: c.score ?? 0,
      author: c.author ?? "[unknown]",
      created_utc: c.created_utc ?? 0,
      depth,
      permalink: c.permalink ?? "",
    });

    if (depth < 2 && c.replies?.data?.children) {
      comments.push(...flattenComments(c.replies.data.children, depth + 1));
    }
  }
  return comments;
}

// ─── Storage (append-only JSON, dedup by post ID) ─────────────────────────

function loadStorage() {
  if (!existsSync(STORAGE_FILE)) return { subreddit: SUBREDDIT, posts: [], lastUpdated: 0 };
  return JSON.parse(readFileSync(STORAGE_FILE, "utf8"));
}

function saveStorage(storage) {
  if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true });
  storage.lastUpdated = Date.now();
  writeFileSync(STORAGE_FILE, JSON.stringify(storage, null, 2));
  console.log(`  Saved ${storage.posts.length} posts to ${STORAGE_FILE}`);
}

function mergePosts(existing, newPosts) {
  const byId = new Map(existing.map(p => [p.id, p]));
  let added = 0, updated = 0;
  for (const p of newPosts) {
    if (byId.has(p.id)) {
      const prev = byId.get(p.id);
      if ((p.comments?.length || 0) > (prev.comments?.length || 0)) {
        byId.set(p.id, p);
        updated++;
      }
    } else {
      byId.set(p.id, p);
      added++;
    }
  }
  return { posts: [...byId.values()], added, updated };
}

// ─── Main ingestion ───────────────────────────────────────────────────────

async function main() {
  const mode = POSTS_ONLY ? "posts-only" : "posts+comments";
  const historicalNote = MONTHS_BACK > 0 ? `, ${MONTHS_BACK} months back` : "";
  console.log(`\n  Reddit Memory Ingestion — r/${SUBREDDIT} (${SORT}, limit ${LIMIT}, ${mode}${historicalNote})\n`);

  // 1. Fetch posts
  console.log(`[1] Fetching posts...`);
  let posts;
  if (MONTHS_BACK > 0 || process.argv.includes("--deep")) {
    posts = await fetchPostsDeepHistory();
  } else {
    posts = await fetchPostsViaListing(SORT, LIMIT);
  }
  if (posts.length === 0) { console.log("  No posts found."); return; }

  // 2. Fetch comments (unless --posts-only)
  if (POSTS_ONLY) {
    console.log(`\n[2] Skipping comments (--posts-only)`);
    for (const p of posts) {
      if (!p.comments) p.comments = [];
    }
  } else {
    // Load existing storage once (avoid duplicate reads)
    const existingStorage = loadStorage();
    const existingComments = new Map(
      existingStorage.posts.filter(p => p.comments?.length > 0).map(p => [p.id, p.comments])
    );
    const needComments = posts.filter(p => !existingComments.has(p.id));
    const haveComments = posts.length - needComments.length;
    console.log(`\n[2] Fetching comments: ${needComments.length} posts need comments, ${haveComments} already have them`);

    // Attach existing comments to posts
    for (const post of posts) {
      if (existingComments.has(post.id)) {
        post.comments = existingComments.get(post.id);
      }
    }

    // Fetch comments in parallel batches (3 concurrent) with adaptive rate limiting
    const BATCH_SIZE = 3;
    let completed = 0;
    for (let i = 0; i < needComments.length; i += BATCH_SIZE) {
      const batch = needComments.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(post => fetchComments(post.id))
      );
      for (let j = 0; j < batch.length; j++) {
        batch[j].comments = results[j].status === "fulfilled" ? results[j].value : [];
        completed++;
      }
      process.stdout.write(`\r  [${completed}/${needComments.length}] comments fetched`);
      if (i + BATCH_SIZE < needComments.length) await adaptiveSleep(1200);
    }
    console.log();
  }

  // 3. Merge with existing storage (reuse already-loaded storage to avoid duplicate read)
  console.log(`\n[3] Merging with storage...`);
  const storage = POSTS_ONLY ? loadStorage() : (existingStorage || loadStorage());
  const { posts: merged, added, updated } = mergePosts(storage.posts, posts);
  storage.posts = merged;
  console.log(`  ${added} new, ${updated} updated, ${merged.length} total`);

  // 4. Save
  console.log(`\n[4] Saving...`);
  saveStorage(storage);

  // 5. Summary
  const totalComments = merged.reduce((s, p) => s + (p.comments?.length || 0), 0);
  const dates = merged.map(p => p.created_utc).sort((a, b) => a - b);
  console.log(`\n  Summary:`);
  console.log(`    Posts: ${merged.length}`);
  console.log(`    Comments: ${totalComments}`);
  console.log(`    Date range: ${new Date(dates[0] * 1000).toISOString().slice(0, 10)} → ${new Date(dates[dates.length - 1] * 1000).toISOString().slice(0, 10)}`);

  // Posts per month
  const byMonth = {};
  for (const p of merged) {
    const d = new Date(p.created_utc * 1000);
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[mk] = (byMonth[mk] || 0) + 1;
  }
  console.log(`    Posts per month:`, byMonth);
  console.log();
}

main().catch(err => { console.error("\nFailed:", err.message); process.exit(1); });
