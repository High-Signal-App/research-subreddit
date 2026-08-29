import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchIndex,
  excerpt,
  rankPosts,
  tokenize,
} from "./search-ranking.mjs";

/** @param {string} id @param {string} title @param {string} [selftext] */
const post = (id, title, selftext = "") => ({
  id,
  permalink: `/r/test/comments/${id}/`,
  title,
  selftext,
});

test("tokenize case-folds, splits on punctuation, and drops single characters", () => {
  assert.deepEqual(tokenize("Vector DBs: Qdrant vs. pgvector — a 2026 take"), [
    "vector",
    "dbs",
    "qdrant",
    "vs",
    "pgvector",
    "2026",
    "take",
  ]);
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize("a I x"), []);
});

test("ranking prefers title matches over body mentions", () => {
  const index = buildSearchIndex([
    post(
      "body",
      "Weekly discussion thread",
      "Someone asked about qdrant deployment costs in passing.",
    ),
    post(
      "title",
      "Qdrant deployment costs",
      "We moved our cluster last month.",
    ),
  ]);
  const ranked = rankPosts(index, "qdrant deployment");
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].post.id, "title");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("ranking rewards rarer query terms", () => {
  const common = Array.from({ length: 20 }, (_, n) =>
    post(`c${n}`, "Reddit thread about models", "models models models"),
  );
  const index = buildSearchIndex([
    ...common,
    post("rare", "Reddit thread about pgvector", "pgvector notes"),
  ]);
  const ranked = rankPosts(index, "models pgvector");
  assert.equal(ranked[0].post.id, "rare");
});

test("ranking handles empty queries, unseen terms, and empty corpora", () => {
  const index = buildSearchIndex([post("a", "Hello world")]);
  assert.deepEqual(rankPosts(index, ""), []);
  assert.deepEqual(rankPosts(index, "   !!!  "), []);
  assert.deepEqual(rankPosts(index, "zzzznotpresent"), []);
  assert.deepEqual(rankPosts(buildSearchIndex([]), "hello"), []);
});

test("ranking honours the result limit and stays deterministic", () => {
  const index = buildSearchIndex(
    Array.from({ length: 10 }, (_, n) =>
      post(`p${n}`, "identical title", "identical body"),
    ),
  );
  const first = rankPosts(index, "identical", 3);
  assert.equal(first.length, 3);
  assert.deepEqual(
    first.map((entry) => entry.post.id),
    rankPosts(index, "identical", 3).map((entry) => entry.post.id),
  );
  assert.equal(rankPosts(index, "identical", 0).length, 0);
});

test("index statistics reconcile with the corpus", () => {
  const index = buildSearchIndex([
    post("a", "alpha beta", "gamma"),
    post("b", "alpha", ""),
  ]);
  assert.equal(index.documents.length, 2);
  // "alpha" appears in both documents; the title is weighted twice.
  assert.equal(index.documentFrequency.get("alpha"), 2);
  assert.equal(index.documents[0].terms.get("alpha"), 2);
  assert.equal(index.documentFrequency.get("gamma"), 1);
  assert.ok(index.averageLength > 0);
});

test("excerpt centres on the matched term and marks truncation", () => {
  const body = `${"filler word ".repeat(30)}qdrant matters here${" trailing word".repeat(30)}`;
  const preview = excerpt(body, "qdrant");
  assert.ok(preview.includes("qdrant"));
  assert.ok(preview.startsWith("…"));
  assert.ok(preview.length < body.length);
  assert.equal(excerpt("short body", "qdrant"), "short body");
  assert.equal(excerpt("", "qdrant"), "");
  assert.ok(excerpt("x".repeat(400), "qdrant").endsWith("…"));
});
