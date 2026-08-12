import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COMMUNITIES } from "./communities.js";
import { collectCommunity, compactPost, runCollection, snapshotKey } from "./worker.js";

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
