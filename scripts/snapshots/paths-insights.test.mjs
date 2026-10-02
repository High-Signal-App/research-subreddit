import assert from "node:assert/strict";
import test from "node:test";
import { parseSnapshotLocation, snapshotPath, snapshotPostPath } from "./viewer/paths.mjs";
import { snapshotInsights, compareCollections } from "./viewer/insights.mjs";

const post = (id, score, commentCount = 0, flair = null) => ({ id, title: `Post ${id}`, body: "Evidence", score, commentCount, flair, removalState: null });
const collection = (posts, date = "2026-10-01") => ({ subreddit: "Cloud", date, posts, coverage: { status: "complete", listingCapped: false }, window: { start: "2026-09-30T00:17:49Z", end: "2026-10-01T00:17:49Z" } });

test("clean date routes and short pinned shares retain identity; legacy links remain readable", () => {
  const snapshot = { subreddit: "AI_Agents", date: "2026-10-01", source: { revision: "a".repeat(64) } };
  assert.equal(snapshotPath(snapshot), "/r/AI_Agents/2026-10-01/");
  assert.equal(snapshotPath(snapshot, true), "/r/AI_Agents/2026-10-01/aaaaaaaaaaaa/");
  assert.deepEqual(parseSnapshotLocation(snapshotPath(snapshot)), { subreddit: "AI_Agents", date: "2026-10-01", version: undefined, pinned: false });
  assert.equal(parseSnapshotLocation(snapshotPath(snapshot, true)).pinned, true);
  assert.equal(snapshotPostPath(snapshot, "1wu2d7b"), "/r/AI_Agents/2026-10-01/aaaaaaaaaaaa/#post-1wu2d7b");
  assert.equal(parseSnapshotLocation(snapshotPostPath(snapshot, "1wu2d7b")).pinned, true);
  assert.throws(() => snapshotPostPath(snapshot, "../bad"));
  assert.equal(parseSnapshotLocation("/r/AI_Agents/2026-10-01").date, snapshot.date);
  const old = parseSnapshotLocation(`/snapshots/?subreddit=AI_Agents&date=2026-10-01&run=123&revision=${snapshot.source.revision}`);
  assert.equal(old.revision, snapshot.source.revision); assert.equal(old.pinned, true);
  assert.equal(parseSnapshotLocation("/snapshots/").pinned, false);
});
test("routes reject impossible dates, invalid identity and malformed versions", () => {
  for (const path of ["/r/Cloud/2026-02-30/", "/r/Cloud/2026-13-01/", "/r/%2Fsecret/2026-10-01/", "/r/Cloud/2026-10-01/no-version/", "/r/Cloud/2026-10-01/" + "a".repeat(64), "/snapshots/?run=nope", "/snapshots/?revision=bad"]) assert.equal(parseSnapshotLocation(path).invalid, true, path);
  assert.throws(() => snapshotPath({ subreddit: "../secret", date: "2026-10-01" }));
});
test("insights compute actual medians, deterministic leaders, reply concentration and flair counts", () => {
  const data = snapshotInsights(collection([post("b", 9, 6, " Demo "), post("a", 9, 6, "Demo"), post("c", -1, 0), post("d", 1, 0)]));
  assert.equal(data.medianScore, 5); assert.equal(data.highestScore.id, "a"); assert.equal(data.mostDiscussed.id, "a");
  assert.equal(data.mostDiscussed.share, 50); assert.equal(data.lowScorePosts, 2);
  assert.deepEqual(data.contentMix, [{ label: "Demo", count: 2, percent: 50 }, { label: "Unlabelled", count: 2, percent: 50 }]);
  assert.equal(snapshotInsights(collection([post("a", -1), post("b", 3), post("c", 7)])).medianScore, 3);
  assert.equal(snapshotInsights(collection([post("a", 0)])).mostDiscussed.share, null);
});
test("failed, empty, redacted, partial and invalid evidence do not invent findings", () => {
  assert.equal(snapshotInsights(collection([])).available, false);
  const removed = { ...post("removed", 999, 999), title: "PRIVATE", body: "PRIVATE", removalState: "deleted" };
  const partial = collection([post("a", 1), removed]); partial.coverage.status = "partial";
  const result = snapshotInsights(partial); assert.equal(result.posts, 1); assert.equal(result.excludedRemoved, 1); assert.equal(result.status, "partial"); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  assert.equal(snapshotInsights(collection([removed])).available, false);
  partial.coverage.status = "failed"; assert.equal(snapshotInsights(partial).available, false);
  assert.equal(snapshotInsights(collection([post("a", NaN)])).available, false);
});
test("comparison measures captured post counts only across comparable daily windows", () => {
  const current = collection(Array.from({ length: 71 }, (_, i) => post(String(i), 1)));
  const previous = collection(Array.from({ length: 96 }, (_, i) => post(String(i), 1)), "2026-09-30");
  previous.window = { start: "2026-09-29T00:17:28Z", end: "2026-09-30T00:17:28Z" };
  const result = compareCollections(current, previous);
  assert.equal(result.comparable, true); assert.equal(result.postChangePercent, -26); assert.equal(result.previousPosts, 96);
  assert.match(result.note, /not total subreddit activity/); assert.match(result.note, /comment counts are not compared/);
  for (const mutate of [p => p.coverage.status = "partial", p => p.coverage.listingCapped = true, p => p.subreddit = "Other", p => p.window.end = "2026-09-30T01:17:28Z", p => p.posts = [], p => p.posts[0].removalState = "deleted"]) {
    const altered = structuredClone(previous); mutate(altered); assert.equal(compareCollections(current, altered).comparable, false);
  }
  assert.equal(compareCollections(current, null).comparable, false);
});
