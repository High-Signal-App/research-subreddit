import { COMMUNITIES } from "./communities.js";

const LISTING_LIMIT = 100;
const CONCURRENCY = 5;
const MAX_ATTEMPTS = 3;
// Reddit reports its remaining call budget per window. Pause the run rather
// than spend the last of it, so a burst never turns into a 429 storm.
const RATE_LIMIT_FLOOR = 5;
// A single wait never blocks the scheduled run for longer than this, however
// long Reddit asks us to back off.
const MAX_WAIT_MS = 60_000;
// A subreddit that is private, banned, or gone will answer the same way on
// every attempt. Retrying it wastes budget that working communities need.
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 410, 451]);

class CollectionError extends Error {
  constructor(message, { status = 0, permanent = false, waitMs = 0 } = {}) {
    super(message);
    this.name = "CollectionError";
    this.status = status;
    this.permanent = permanent;
    this.waitMs = waitMs;
  }
}

export function compactPost(post) {
  return {
    id: String(post?.id || ""),
    permalink: String(post?.permalink || ""),
    title: String(post?.title || "Untitled post").slice(0, 500),
    selftext: String(post?.selftext || "").trim().slice(0, 1600),
    score: Number(post?.score || 0),
    num_comments: Number(post?.num_comments || 0),
    upvote_ratio: Number(post?.upvote_ratio || 0),
    link_flair_text: String(post?.link_flair_text || ""),
    created_utc: Number(post?.created_utc || 0),
  };
}

export function snapshotKey(date, subreddit) {
  return `snapshots/${date}/${subreddit}.json.gz`;
}

// An absent header must stay unknown: Number(null) is 0, which would read as a
// spent budget and pause every batch for no reason.
function count(header) {
  if (header === null || header.trim() === "") return null;
  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function seconds(header) {
  const value = count(header);
  return value === null ? null : Math.min(value * 1000, MAX_WAIT_MS);
}

// Reddit sends Retry-After and X-Ratelimit-* in seconds, so no clock is needed
// to interpret them — which keeps this deterministic under test.
export function readRateLimit(response) {
  return {
    remaining: count(response.headers.get("X-Ratelimit-Remaining")),
    resetMs: seconds(response.headers.get("X-Ratelimit-Reset")),
    retryAfterMs: seconds(response.headers.get("Retry-After")),
  };
}

function failureFor(response, prefix) {
  const limit = readRateLimit(response);
  const permanent = PERMANENT_STATUSES.has(response.status);
  // Honour an explicit backoff instruction; fall back to the window reset when
  // rate limited without one.
  const waitMs = limit.retryAfterMs ?? (response.status === 429 ? limit.resetMs || 0 : 0);
  return new CollectionError(`${prefix}_${response.status}`, { status: response.status, permanent, waitMs });
}

async function gzipJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const compressed = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(compressed).arrayBuffer();
}

async function getOAuthToken(env, fetcher, budget, sleep) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const credentials = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
      const response = await fetcher("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": env.REDDIT_USER_AGENT,
        },
        body: "grant_type=client_credentials",
      });
      budget.observe(response);
      if (!response.ok) throw failureFor(response, "oauth");
      const payload = await response.json();
      if (typeof payload?.access_token !== "string") throw new CollectionError("oauth_invalid_response");
      return payload.access_token;
    } catch (error) {
      lastError = error;
      // Bad credentials cannot be fixed by waiting, and the whole run depends
      // on this call, so surface it immediately.
      if (error instanceof CollectionError && error.permanent) throw error;
      if (attempt < MAX_ATTEMPTS) await budget.wait(sleep, Math.max(error?.waitMs || 0, attempt * 500));
    }
  }
  throw lastError instanceof Error ? lastError : new CollectionError("oauth_failed");
}

async function fetchListing(subreddit, token, env, fetcher, budget) {
  const url = new URL(`https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/new`);
  url.searchParams.set("limit", String(LISTING_LIMIT));
  url.searchParams.set("raw_json", "1");
  const response = await fetcher(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": env.REDDIT_USER_AGENT,
    },
  });
  budget.observe(response);
  if (!response.ok) throw failureFor(response, "reddit");
  const payload = await response.json();
  const children = Array.isArray(payload?.data?.children) ? payload.data.children : [];
  return {
    after: payload?.data?.after || null,
    posts: children.map(item => compactPost(item?.data)).filter(post => post.id && post.created_utc > 0),
  };
}

// Shared, observable view of what Reddit says is left in the current window.
export function rateLimitBudget() {
  const state = { remaining: null, resetMs: null, waits: 0, waitedMs: 0 };
  return {
    state,
    observe(response) {
      const limit = readRateLimit(response);
      if (limit.remaining !== null) state.remaining = limit.remaining;
      if (limit.resetMs !== null) state.resetMs = limit.resetMs;
    },
    async wait(sleep, milliseconds) {
      if (!(milliseconds > 0)) return;
      state.waits += 1;
      state.waitedMs += milliseconds;
      await sleep(milliseconds);
    },
    exhausted() {
      return state.remaining !== null && state.remaining <= RATE_LIMIT_FLOOR;
    },
  };
}

export async function collectCommunity({ subreddit, date, collectedAt, token, env, fetcher = fetch, sleep = delay, budget = rateLimitBudget() }) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const listing = await fetchListing(subreddit, token, env, fetcher, budget);
      const snapshot = {
        schema: "reddit-insights.daily-snapshot.v1",
        subreddit,
        collectedAt,
        source: { listing: "new", limit: LISTING_LIMIT, after: listing.after },
        posts: listing.posts,
      };
      await env.ARCHIVE.put(snapshotKey(date, subreddit), await gzipJson(snapshot), {
        httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
        customMetadata: { subreddit, collectedAt, schema: snapshot.schema },
      });
      return { subreddit, status: "stored", posts: listing.posts.length };
    } catch (error) {
      lastError = error;
      if (error instanceof CollectionError && error.permanent) break;
      // Prefer Reddit's own backoff instruction over our linear fallback.
      if (attempt < MAX_ATTEMPTS) await budget.wait(sleep, Math.max(error?.waitMs || 0, attempt * 500));
    }
  }
  throw lastError instanceof Error ? lastError : new CollectionError("collection_failed");
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function runCollection(env, options = {}) {
  const fetcher = options.fetcher || fetch;
  const communities = options.communities || COMMUNITIES;
  const now = options.now || new Date();
  const sleep = options.sleep || delay;
  const budget = options.budget || rateLimitBudget();
  const collectedAt = now.toISOString();
  const date = collectedAt.slice(0, 10);
  const token = await getOAuthToken(env, fetcher, budget, sleep);
  const results = [];

  for (let offset = 0; offset < communities.length; offset += CONCURRENCY) {
    // Spend the window down to the floor, then wait for it to refill instead of
    // pushing the remaining batches into 429s.
    if (offset > 0 && budget.exhausted()) {
      await budget.wait(sleep, budget.state.resetMs || 1000);
    }
    const batch = communities.slice(offset, offset + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(subreddit =>
      collectCommunity({ subreddit, date, collectedAt, token, env, fetcher, sleep, budget })
    ));
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") results.push(result.value);
      else {
        const error = result.reason;
        results.push({
          subreddit: batch[index],
          status: "failed",
          error: error instanceof Error ? error.message : "collection_failed",
          // A permanent failure is a roster problem to fix, not a transient
          // blip to re-run, so name the difference in the manifest.
          permanent: error instanceof CollectionError ? error.permanent : false,
        });
      }
    });
  }

  const failed = results.filter(result => result.status === "failed");
  const manifest = {
    schema: "reddit-insights.daily-run.v1",
    collectedAt,
    status: failed.length ? "partial" : "complete",
    requested: communities.length,
    stored: results.length - failed.length,
    failed: failed.length,
    permanentFailures: failed.filter(result => result.permanent).length,
    rateLimit: { remaining: budget.state.remaining, waits: budget.state.waits, waitedMs: budget.state.waitedMs },
    results,
  };
  await env.ARCHIVE.put(`runs/${date}.json`, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
  });
  console.log(JSON.stringify({ event: "daily_collection", ...manifest, results: undefined }));
  if (failed.length) throw new Error(`partial_collection_${failed.length}_failed`);
  return manifest;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/health") {
      return new Response("Not found", { status: 404 });
    }
    return Response.json({
      service: "reddit-insights-daily-collector",
      configuredCommunities: COMMUNITIES.length,
      storage: "R2",
      collection: "newest 100 posts per community per UTC day",
      rateLimit: { concurrency: CONCURRENCY, maxAttempts: MAX_ATTEMPTS, pauseBelowRemaining: RATE_LIMIT_FLOOR, maxWaitMs: MAX_WAIT_MS },
    });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCollection(env, { now: new Date(controller.scheduledTime) }));
  },
};
