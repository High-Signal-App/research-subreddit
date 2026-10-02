import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { sha256 } from "./archive.mjs";
import { archivePrefix, renewSource, replaceSource, publishPrepared, EXPORT_PREFIX } from "./publication.mjs";

const source = { run: "12", attempt: "1", revision: "a".repeat(64) };
const bytes = gzipSync("{}");
const entry = { subreddit: "AI_Agents", date: "2026-10-01", source, key: `snapshots/2026-10-01/AI_Agents/12-${source.revision}.json.gz`, sha256: sha256(bytes), bytes: bytes.length };
test("publication rejects arbitrary archive identities and renews only unchanged authoritative receipts", () => {
  assert.equal(archivePrefix(entry), "reddit/v2/run=12/attempt=1/date=2026-10-01");
  assert.throws(() => archivePrefix({ ...entry, source: { ...source, run: "../x" } }));
  const manifest = Buffer.from(JSON.stringify({ objectPrefix: archivePrefix(entry) }));
  assert.equal(renewSource([entry], manifest), null);
  const matching = { ...entry, source: { ...source, revision: sha256(manifest) } };
  const renewed = renewSource([matching], manifest, 0);
  assert.equal(renewed[0].expiresAt, "1970-01-02T00:00:00.000Z");
  assert.equal(renewSource([matching], Buffer.from('{}')), null);
});
test("changed source replaces all its old community revisions while preserving other dates", () => {
  const other = { ...entry, date: "2026-09-30" };
  const prepared = [{ bytes, entry: { ...entry, source: { ...source, revision: "b".repeat(64) } } }];
  const result = replaceSource({ entries: [entry, other] }, prepared);
  assert.deepEqual(result.entries, [other, prepared[0].entry]);
});
test("catalog publication follows uploads and verification; either failure leaves the old catalog active", async () => {
  const prepared = [{ bytes, entry }], catalog = { schema: "reddit-insights.catalog.v1", entries: [entry] };
  const writes = [];
  await assert.rejects(publishPrepared(catalog, prepared, async key => { writes.push(key); }, async () => { throw new Error("readback failed"); }));
  assert.deepEqual(writes, [EXPORT_PREFIX + entry.key]);
  writes.length = 0;
  await assert.rejects(publishPrepared(catalog, prepared, async () => { throw new Error("upload failed"); }, async () => { writes.push("verified"); }));
  assert.deepEqual(writes, []);
  await publishPrepared(catalog, prepared, async key => { writes.push(key); }, async () => { writes.push("verified"); });
  assert.deepEqual(writes, [EXPORT_PREFIX + entry.key, "verified", EXPORT_PREFIX + "index.json"]);
});
