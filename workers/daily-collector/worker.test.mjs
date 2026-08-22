import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COMMUNITIES } from "./communities.js";
import { collectCommunity, compactPost, rateLimitBudget, readRateLimit, runCollection, snapshotKey } from "./worker.js";

function post(id = "abc") {
  return {
    id,
    permalink: `/r/test/comments/${id}/example/`,
    title: "A useful title",
    selftext: "Body",
    score: 42,
    num_comments: 7,
    upvote_ratio: 0.91,
    link_flair_text: "Research",
    created_utc: 1_786_291_200,
    author: "not-stored",
  };
}

function listing(id = "abc") {
  return { data: { after: `t3_${id}`, children: [{ data: post(id) }] } };
}

function mockEnv(writes) {
  return {
    REDDIT_CLIENT_ID: "client",
    REDDIT_CLIENT_SECRET: "secret",
    REDDIT_USER_AGENT: "test-agent",
    ARCHIVE: {
      async put(key, value, options) {
        writes.push({ key, value, options });
      },
    },
  };
}

test("compactPost keeps only longitudinal display fields", () => {
  const compact = compactPost(post());
  assert.deepEqual(Object.keys(compact), [
    "id", "permalink", "title", "selftext", "score", "num_comments",
    "upvote_ratio", "link_flair_text", "created_utc",
  ]);
  assert.equal("author" in compact, false);
});

test("snapshot keys are deterministic by UTC date and subreddit", () => {
  assert.equal(snapshotKey("2026-08-10", "LocalLLaMA"), "snapshots/2026-08-10/LocalLLaMA.json.gz");
});

test("collector roster matches the active display roster", () => {
  const index = JSON.parse(readFileSync("data/reddit-display/index.json", "utf8"));
  const roster = JSON.parse(readFileSync("config/community-roster.json", "utf8"));
  const excluded = new Set(roster.excludedCommunities);
  const active = index.rows.map(row => row.subreddit).filter(name => !excluded.has(name));
  assert.deepEqual(COMMUNITIES, active);
});

test("collectCommunity writes one gzip snapshot", async () => {
  const writes = [];
  const result = await collectCommunity({
    subreddit: "LocalLLaMA",
    date: "2026-08-10",
    collectedAt: "2026-08-10T02:17:00.000Z",
    token: "token",
    env: mockEnv(writes),
    fetcher: async () => Response.json(listing()),
    sleep: async () => {},
  });
  assert.deepEqual(result, { subreddit: "LocalLLaMA", status: "stored", posts: 1 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, "snapshots/2026-08-10/LocalLLaMA.json.gz");
  assert.equal(writes[0].options.httpMetadata.contentEncoding, "gzip");
});

test("runCollection stores a partial manifest and reports failure", async () => {
  const writes = [];
  const fetcher = async input => {
    const url = String(input);
    if (url.includes("access_token")) return Response.json({ access_token: "token" });
    if (url.includes("/r/good/")) return Response.json(listing("good"));
    return new Response("unavailable", { status: 503 });
  };
  await assert.rejects(
    runCollection(mockEnv(writes), {
      communities: ["good", "bad"],
      now: new Date("2026-08-10T02:17:00.000Z"),
      fetcher,
      sleep: async () => {},
    }),
    /partial_collection_1_failed/,
  );
  const manifestWrite = writes.find(write => write.key === "runs/2026-08-10.json");
  assert.ok(manifestWrite);
  const manifest = JSON.parse(manifestWrite.value);
  assert.equal(manifest.status, "partial");
  assert.equal(manifest.stored, 1);
  assert.equal(manifest.failed, 1);
});

test("readRateLimit reads Reddit's second-based headers", () => {
  const response = new Response("", {
    headers: { "X-Ratelimit-Remaining": "3", "X-Ratelimit-Reset": "12", "Retry-After": "7" },
  });
  assert.deepEqual(readRateLimit(response), { remaining: 3, resetMs: 12_000, retryAfterMs: 7_000 });
});

test("readRateLimit ignores absent or unparseable headers", () => {
  assert.deepEqual(readRateLimit(new Response("")), { remaining: null, resetMs: null, retryAfterMs: null });
  const bad = new Response("", { headers: { "X-Ratelimit-Remaining": "soon", "Retry-After": "later" } });
  assert.deepEqual(readRateLimit(bad), { remaining: null, resetMs: null, retryAfterMs: null });
});

test("a 429 waits for the interval Reddit asks for, not the linear fallback", async () => {
  const waits = [];
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    if (calls === 1) return new Response("slow down", { status: 429, headers: { "Retry-After": "9" } });
    return Response.json(listing());
  };
  const result = await collectCommunity({
    subreddit: "LocalLLaMA",
    date: "2026-08-10",
    collectedAt: "2026-08-10T02:17:00.000Z",
    token: "token",
    env: mockEnv([]),
    fetcher,
    sleep: async ms => { waits.push(ms); },
  });
  assert.equal(result.status, "stored");
  // 9s from Retry-After, not the 500ms first-attempt fallback.
  assert.deepEqual(waits, [9_000]);
});

test("a permanent status fails immediately without retrying", async () => {
  const waits = [];
  let calls = 0;
  const fetcher = async () => { calls += 1; return new Response("private", { status: 403 }); };
  await assert.rejects(collectCommunity({
    subreddit: "gone",
    date: "2026-08-10",
    collectedAt: "2026-08-10T02:17:00.000Z",
    token: "token",
    env: mockEnv([]),
    fetcher,
    sleep: async ms => { waits.push(ms); },
  }), /reddit_403/);
  assert.equal(calls, 1, "a 403 subreddit is not retried");
  assert.deepEqual(waits, []);
});

test("a transient status still retries up to the attempt limit", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return new Response("boom", { status: 500 }); };
  await assert.rejects(collectCommunity({
    subreddit: "flaky",
    date: "2026-08-10",
    collectedAt: "2026-08-10T02:17:00.000Z",
    token: "token",
    env: mockEnv([]),
    fetcher,
    sleep: async () => {},
  }), /reddit_500/);
  assert.equal(calls, 3);
});

test("the run pauses between batches once the window is nearly spent", async () => {
  const waits = [];
  const fetcher = async input => {
    const url = String(input);
    if (url.includes("access_token")) return Response.json({ access_token: "token" });
    return Response.json(listing(), { headers: { "X-Ratelimit-Remaining": "1", "X-Ratelimit-Reset": "30" } });
  };
  // Seven communities at a concurrency of five means one batch boundary.
  const manifest = await runCollection(mockEnv([]), {
    communities: ["a", "b", "c", "d", "e", "f", "g"],
    now: new Date("2026-08-10T02:17:00.000Z"),
    fetcher,
    sleep: async ms => { waits.push(ms); },
  });
  assert.equal(manifest.status, "complete");
  assert.deepEqual(waits, [30_000], "waited one window reset at the batch boundary");
  assert.equal(manifest.rateLimit.remaining, 1);
  assert.equal(manifest.rateLimit.waits, 1);
});

test("the manifest separates permanent failures from transient ones", async () => {
  const writes = [];
  const fetcher = async input => {
    const url = String(input);
    if (url.includes("access_token")) return Response.json({ access_token: "token" });
    if (url.includes("/r/good/")) return Response.json(listing("good"));
    if (url.includes("/r/banned/")) return new Response("banned", { status: 404 });
    return new Response("unavailable", { status: 503 });
  };
  await assert.rejects(runCollection(mockEnv(writes), {
    communities: ["good", "banned", "flaky"],
    now: new Date("2026-08-10T02:17:00.000Z"),
    fetcher,
    sleep: async () => {},
  }), /partial_collection_2_failed/);
  const manifest = JSON.parse(writes.find(write => write.key === "runs/2026-08-10.json").value);
  assert.equal(manifest.stored, 1);
  assert.equal(manifest.failed, 2);
  assert.equal(manifest.permanentFailures, 1);
  assert.equal(manifest.results.find(r => r.subreddit === "banned").permanent, true);
  assert.equal(manifest.results.find(r => r.subreddit === "flaky").permanent, false);
});

test("bad credentials abort the run before any community is collected", async () => {
  const writes = [];
  let listingCalls = 0;
  const fetcher = async input => {
    const url = String(input);
    if (url.includes("access_token")) return new Response("nope", { status: 401 });
    listingCalls += 1;
    return Response.json(listing());
  };
  await assert.rejects(runCollection(mockEnv(writes), {
    communities: ["good"],
    now: new Date("2026-08-10T02:17:00.000Z"),
    fetcher,
    sleep: async () => {},
  }), /oauth_401/);
  assert.equal(listingCalls, 0);
  assert.equal(writes.length, 0, "no snapshot or manifest is written");
});

test("a transient oauth failure is retried rather than losing the whole run", async () => {
  let tokenCalls = 0;
  const fetcher = async input => {
    const url = String(input);
    if (url.includes("access_token")) {
      tokenCalls += 1;
      if (tokenCalls === 1) return new Response("later", { status: 503 });
      return Response.json({ access_token: "token" });
    }
    return Response.json(listing());
  };
  const manifest = await runCollection(mockEnv([]), {
    communities: ["good"],
    now: new Date("2026-08-10T02:17:00.000Z"),
    fetcher,
    sleep: async () => {},
  });
  assert.equal(tokenCalls, 2);
  assert.equal(manifest.status, "complete");
});

test("the budget only pauses once the floor is reached", () => {
  const budget = rateLimitBudget();
  assert.equal(budget.exhausted(), false, "an unknown budget never blocks the run");
  budget.observe(new Response("", { headers: { "X-Ratelimit-Remaining": "40" } }));
  assert.equal(budget.exhausted(), false);
  budget.observe(new Response("", { headers: { "X-Ratelimit-Remaining": "2" } }));
  assert.equal(budget.exhausted(), true);
});
