import { COMMUNITIES } from "./communities.js";

const LISTING_LIMIT = 100;
const CONCURRENCY = 5;
const MAX_ATTEMPTS = 3;

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

async function gzipJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const compressed = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(compressed).arrayBuffer();
}

async function getOAuthToken(env, fetcher) {
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
  if (!response.ok) throw new Error(`oauth_${response.status}`);
  const payload = await response.json();
  if (typeof payload?.access_token !== "string") throw new Error("oauth_invalid_response");
  return payload.access_token;
}

async function fetchListing(subreddit, token, env, fetcher) {
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
  if (!response.ok) throw new Error(`reddit_${response.status}`);
  const payload = await response.json();
  const children = Array.isArray(payload?.data?.children) ? payload.data.children : [];
  return {
    after: payload?.data?.after || null,
    posts: children.map(item => compactPost(item?.data)).filter(post => post.id && post.created_utc > 0),
  };
}

export async function collectCommunity({ subreddit, date, collectedAt, token, env, fetcher = fetch, sleep = delay }) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const listing = await fetchListing(subreddit, token, env, fetcher);
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
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 500);
    }
  }
  throw new Error(lastError instanceof Error ? lastError.message : "collection_failed");
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function runCollection(env, options = {}) {
  const fetcher = options.fetcher || fetch;
  const communities = options.communities || COMMUNITIES;
  const now = options.now || new Date();
  const sleep = options.sleep || delay;
  const collectedAt = now.toISOString();
  const date = collectedAt.slice(0, 10);
  const token = await getOAuthToken(env, fetcher);
  const results = [];

  for (let offset = 0; offset < communities.length; offset += CONCURRENCY) {
    const batch = communities.slice(offset, offset + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(subreddit =>
      collectCommunity({ subreddit, date, collectedAt, token, env, fetcher, sleep })
    ));
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") results.push(result.value);
      else results.push({
        subreddit: batch[index],
        status: "failed",
        error: result.reason instanceof Error ? result.reason.message : "collection_failed",
      });
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
    });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCollection(env, { now: new Date(controller.scheduledTime) }));
  },
};
