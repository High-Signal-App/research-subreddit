import assert from "node:assert/strict";
import test from "node:test";
import { availableCollections, collectionDates, collectionPreview } from "./viewer/home-model.mjs";

const entry = (subreddit, date, expiresAt = "2026-10-03T00:00:00Z") => ({ subreddit, date, expiresAt, source: { run: "12", revision: "a".repeat(64) } });
test("landing only offers unexpired valid collections and community-specific dates", () => {
  const entries = [entry("AI_Agents", "2026-10-01"), entry("AI_Agents", "2026-09-30"), entry("LocalLLaMA", "2026-10-01"), entry("Expired", "2026-09-29", "2026-10-02T00:00:00Z"), entry("bad/name", "2026-10-01"), entry("Invalid", "2026-02-30")];
  const available = availableCollections(entries, Date.parse("2026-10-02T00:00:00Z"));
  assert.equal(available.length, 3);
  assert.deepEqual(collectionDates(available, "AI_Agents"), ["2026-10-01", "2026-09-30"]);
  assert.deepEqual(collectionDates(available, "LocalLLaMA"), ["2026-10-01"]);
  assert.deepEqual(collectionDates(available, "Expired"), []);
});
const post = (id, score, commentCount, fields = {}) => ({ id, title: id, body: "body", score, commentCount, ...fields });
test("landing proof omits removed posts and ranks recorded evidence without changing the source", () => {
  const posts = [post("removed", 100, 100, { removalState: "removed" }), post("deleted", 99, 99, { body: "[deleted]" }), post("a", 10, 2), post("b", 5, 20), post("c", 8, 0), post("d", 1, 1)];
  const preview = collectionPreview({ coverage: { status: "partial" }, posts });
  assert.deepEqual(preview.posts.map(row => row.id), ["a", "c", "b"]);
  assert.equal(preview.leader.id, "b");
  assert.equal(posts[0].id, "removed");
});
test("failed and empty collections do not provide misleading landing proof", () => {
  const failed = collectionPreview({ coverage: { status: "failed" }, posts: [post("a", 10, 20)] });
  assert.equal(failed.leader, null); assert.deepEqual(failed.posts, []); assert.match(failed.reason, /failed/);
  const empty = collectionPreview({ coverage: { status: "complete" }, posts: [] });
  assert.equal(empty.leader, null); assert.deepEqual(empty.posts, []); assert.match(empty.reason, /No posts/);
});
