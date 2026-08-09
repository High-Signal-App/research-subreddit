#!/usr/bin/env node
/**
 * Backfill high-karma comments for a subreddit.
 *
 * Instead of fetching comments for every post (slow + huge), this:
 *   1. Picks the top-scoring posts (most engagement = most signal)
 *   2. Fetches comments sorted by "top" (Reddit returns highest-karma first)
 *   3. Only keeps comments above a karma threshold
 *   4. Skips posts that already have comments
 *
 * Usage:
 *   node scripts/backfill-comments.mjs <subreddit> [maxPosts] [minKarma]
 *   node scripts/backfill-comments.mjs SaaS              # top 500 posts, karma >= 5
 *   node scripts/backfill-comments.mjs startups 1000 3   # top 1000 posts, karma >= 3
 *
 * Batch:
 *   node scripts/backfill-comments.mjs --batch            # all subreddits, top 500, karma >= 5
 *   node scripts/backfill-comments.mjs --batch --top 1000 # all subreddits, top 1000
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const SUBREDDIT = process.argv[2] || "";
const IS_BATCH = process.argv.includes("--batch");
const TOP_N = (() => {
  const idx = process.argv.indexOf("--top");
  return idx >= 0 ? parseInt(process.argv[idx + 1], 10) : 500;
})();
const MIN_KARMA = (() => {
  const idx = process.argv.indexOf("--min-karma");
  return idx >= 0 ? parseInt(process.argv[idx + 1], 10) : 5;
})();
const CUSTOM_MAX = process.argv.find((a) => /^\d+$/.test(a) && a !== String(TOP_N));
const MAX_POSTS = CUSTOM_MAX ? parseInt(CUSTOM_MAX, 10) : TOP_N;

const STORAGE_DIR = join(process.cwd(), "data", "reddit-memory");

// ─── Reddit OAuth (same as ingest) ─────────────────────────────────────────

const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || "3HSxjDpyDoDePeegOw8v_w";
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || "X5B8wdAHm2Q4VyCA62uv2ScVwLPmeA";
const UA = "reddit-insights/0.1 (by /u/NexGenBot)";

let cachedToken = null;
let tokenExpiry = 0;
let rateLimitRemaining = 100;
let rateLimitReset = 600;

async function getOAuthToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const creds = btoa(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`);
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
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
      headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
    });
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if (remaining !== null) { rateLimitRemaining = parseFloat(remaining); rateLimitReset = reset ? parseFloat(reset) : 10; }
    if (res.status === 429) {
      const wait = parseInt(reset || "10", 10) + 2;
      console.log(`  429, waiting ${wait}s (attempt ${attempt + 1}/3)...`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) { const text = await res.text().catch(() => ""); throw new Error(`reddit ${res.status}: ${text.slice(0, 200)}`); }
    return await res.json();
  }
  throw new Error("rate-limited after 3 attempts");
}

async function adaptiveSleep(baseMs) {
  if (rateLimitRemaining > 50) await sleep(Math.max(200, baseMs * 0.3));
  else if (rateLimitRemaining > 20) await sleep(baseMs * 0.6);
  else await sleep(Math.max(baseMs, (rateLimitReset / Math.max(1, rateLimitRemaining)) * 1000));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Comment fetching with karma filter ────────────────────────────────────

function flattenComments(children, depth, minKarma) {
  const comments = [];
  for (const child of children) {
    const c = child?.data;
    if (!c || typeof c.body !== "string") continue;
    if (c.body === "[deleted]" || c.body === "[removed]") continue;
    if (c.body.length < 10) continue;
    const score = c.score ?? 0;
    if (score < minKarma) continue; // karma filter

    comments.push({
      id: c.id,
      body: c.body,
      score,
      author: c.author ?? "[unknown]",
      created_utc: c.created_utc ?? 0,
      depth,
      permalink: c.permalink ?? "",
    });

    if (depth < 2 && c.replies?.data?.children) {
      comments.push(...flattenComments(c.replies.data.children, depth + 1, minKarma));
    }
  }
  return comments;
}

async function fetchComments(postId, subreddit, minKarma) {
  const path = `/r/${subreddit}/comments/${postId}.json?limit=50&sort=top&depth=2`;
  try {
    const data = await fetchReddit(path);
    const commentTree = data?.[1]?.data?.children ?? [];
    return flattenComments(commentTree, 0, minKarma);
  } catch {
    return [];
  }
}

// ─── Backfill logic ────────────────────────────────────────────────────────

async function backfillSubreddit(subreddit, maxPosts, minKarma) {
  const storageFile = join(STORAGE_DIR, `${subreddit}.json`);
  if (!existsSync(storageFile)) {
    console.log(`  No data file for r/${subreddit}, skipping`);
    return { subreddit, status: "no-data", fetched: 0 };
  }

  const storage = JSON.parse(readFileSync(storageFile, "utf8"));
  const posts = storage.posts || [];

  // Sort by score descending, pick top N that don't have comments yet
  const sorted = [...posts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const needComments = sorted
    .filter((p) => !p.comments || p.comments.length === 0)
    .slice(0, maxPosts);
  const alreadyHave = sorted.filter((p) => p.comments?.length > 0).length;

  if (needComments.length === 0) {
    console.log(`  r/${subreddit}: all ${alreadyHave} posts already have comments, skipping`);
    return { subreddit, status: "already-done", fetched: 0, haveComments: alreadyHave };
  }

  console.log(`  r/${subreddit}: fetching comments for top ${needComments.length} posts (min karma ${minKarma}), ${alreadyHave} already have comments`);

  const BATCH_SIZE = 3;
  let completed = 0;
  let totalCommentsFetched = 0;

  for (let i = 0; i < needComments.length; i += BATCH_SIZE) {
    const batch = needComments.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((post) => fetchComments(post.id, subreddit, minKarma))
    );
    for (let j = 0; j < batch.length; j++) {
      const comments = results[j].status === "fulfilled" ? results[j].value : [];
      batch[j].comments = comments;
      totalCommentsFetched += comments.length;
      completed++;
    }
    process.stdout.write(`\r  [${completed}/${needComments.length}] posts done, ${totalCommentsFetched} comments so far          `);
    if (i + BATCH_SIZE < needComments.length) await adaptiveSleep(1200);
  }
  console.log();

  // Save
  storage.lastUpdated = Date.now();
  writeFileSync(storageFile, JSON.stringify(storage, null, 2));

  const totalComments = posts.reduce((s, p) => s + (p.comments?.length || 0), 0);
  console.log(`  Saved. r/${subreddit} now has ${totalComments.toLocaleString()} comments across ${posts.length} posts`);
  return { subreddit, status: "ok", fetched: totalCommentsFetched, totalComments };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (IS_BATCH) {
    const files = [...readdirSyncSafe(STORAGE_DIR)]
      .filter((f) => f.endsWith(".json") && !f.includes("report"))
      .map((f) => f.replace(".json", ""));
    console.log(`\n  Batch comment backfill — ${files.length} subreddits, top ${TOP_N} posts each, min karma ${MIN_KARMA}\n`);
    const results = [];
    for (let i = 0; i < files.length; i++) {
      const sub = files[i];
      console.log(`\n  [${i + 1}/${files.length}] r/${sub}`);
      console.log(`  ${"─".repeat(50)}`);
      try {
        const r = await backfillSubreddit(sub, TOP_N, MIN_KARMA);
        results.push(r);
      } catch (err) {
        console.error(`  FAILED: ${err.message}`);
        results.push({ subreddit: sub, status: "failed", error: err.message });
      }
      if (i + 1 < files.length) { execSync("sleep 2"); }
    }
    // Summary
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  BATCH COMMENT BACKFILL COMPLETE`);
    console.log(`${"═".repeat(60)}\n`);
    const ok = results.filter((r) => r.status === "ok");
    const skipped = results.filter((r) => r.status !== "ok");
    const totalFetched = ok.reduce((s, r) => s + (r.fetched || 0), 0);
    console.log(`  Succeeded: ${ok.length}, Skipped/failed: ${skipped.length}`);
    console.log(`  Comments fetched this run: ${totalFetched.toLocaleString()}`);
    console.log();
    for (const r of results.sort((a, b) => (b.fetched || 0) - (a.fetched || 0))) {
      const icon = r.status === "ok" ? "✓" : "○";
      console.log(`  ${icon} r/${r.subreddit.padEnd(22)} ${r.status.padEnd(14)} ${r.fetched || 0} new comments${r.totalComments ? ", " + r.totalComments.toLocaleString() + " total" : ""}`);
    }
    console.log();
  } else {
    if (!SUBREDDIT) {
      console.error("Usage: node scripts/backfill-comments.mjs <subreddit> [maxPosts] [minKarma]  OR  --batch");
      process.exit(1);
    }
    console.log(`\n  Backfilling high-karma comments for r/${SUBREDDIT} (top ${MAX_POSTS} posts, min karma ${MIN_KARMA})\n`);
    await backfillSubreddit(SUBREDDIT, MAX_POSTS, MIN_KARMA);
  }
  console.log();
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

main().catch((err) => { console.error("\nFailed:", err.message); process.exit(1); });
