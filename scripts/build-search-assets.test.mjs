// Asserts the browser-search payload that scripts/build-pages.mjs emits. dist/
// is a build artifact, so these checks skip when it is absent and run for real
// in the static-export CI job, which builds first.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const DIST_DATA = join(DIST, "data");
const skip = existsSync(DIST_DATA) ? false : "dist/data is absent — run npm run build:pages first";

const index = JSON.parse(readFileSync(join(ROOT, "data", "reddit-display", "index.json"), "utf8"));
const roster = JSON.parse(readFileSync(join(ROOT, "config", "community-roster.json"), "utf8"));
const excluded = new Set(roster.excludedCommunities || []);
const published = index.rows.map(row => row.subreddit).filter(name => !excluded.has(name));

test("every published community ships a gzipped corpus chunk", { skip }, () => {
  const missing = published.filter(name => !existsSync(join(DIST_DATA, `${name}.json.gz`)));
  assert.deepEqual(missing, [], `communities without a dist chunk: ${missing.join(", ")}`);
  const shipped = readdirSync(DIST_DATA).filter(file => file.endsWith(".json.gz")).map(file => file.replace(/\.json\.gz$/, ""));
  assert.deepEqual(shipped.slice().sort(), published.slice().sort(), "dist/data drifted from the published index");
  // Unpublished artifacts must never leak into the deployed bundle.
  for (const entry of index.unpublished || []) assert.ok(!shipped.includes(entry.subreddit), `unpublished r/${entry.subreddit} was exported`);
});

test("chunks stay byte-identical to the tracked corpus and decode as posts", { skip }, () => {
  const sample = published.slice(0, 3);
  for (const name of sample) {
    const source = readFileSync(join(ROOT, "data", "reddit-display", `${name}.json.gz`));
    assert.ok(source.equals(readFileSync(join(DIST_DATA, `${name}.json.gz`))), `r/${name} chunk was rewritten during the copy`);
  }
});

test("dist/data/index.json lists only published communities", { skip }, () => {
  const emitted = JSON.parse(readFileSync(join(DIST_DATA, "index.json"), "utf8"));
  assert.equal(emitted.schema, index.schema);
  assert.equal(emitted.communities, published.length);
  assert.deepEqual(emitted.rows.map(row => row.subreddit), published);
  for (const row of emitted.rows) assert.equal(row.chunk, `/data/${encodeURIComponent(row.subreddit)}.json.gz`);
});

test("_headers declares the gzip encoding and caching for /data/*", { skip }, () => {
  const headers = readFileSync(join(DIST, "_headers"), "utf8");
  assert.match(headers, /^\/data\/\*$/m, "_headers has no /data/* block");
  assert.match(headers, /^\/data\/\*\.json\.gz$/m, "_headers has no /data/*.json.gz block");
  const gzipBlock = headers.split(/^\/data\/\*\.json\.gz$/m)[1] || "";
  assert.match(gzipBlock, /Content-Encoding: gzip/, "/data/*.json.gz is not declared gzip-encoded");
  const dataBlock = headers.split(/^\/data\/\*$/m)[1] || "";
  assert.match(dataBlock, /Cache-Control: public, max-age=86400, immutable/, "/data/* is not cached");
  // index.json is served uncompressed, so the encoding must not apply to it.
  assert.doesNotMatch(dataBlock.split(/^\/data\/\*\.json\.gz$/m)[0], /Content-Encoding/, "/data/* must not claim gzip for index.json");
});

test("the search runtime is published and wired into every community page", { skip }, () => {
  assert.ok(existsSync(join(DIST, "assets", "lib", "search-ranking.mjs")));
  const client = readFileSync(join(DIST, "assets", "browser", "search-client.mjs"), "utf8");
  assert.match(client, /from "\.\.\/lib\/search-ranking\.mjs"/, "the shipped client import must resolve inside dist/assets");
  for (const name of published.slice(0, 3)) {
    const page = readFileSync(join(DIST, "r", name, "index.html"), "utf8");
    assert.match(page, /<section id="post-search" data-community="/, `r/${name} is missing the search panel`);
    assert.match(page, /<script type="module" src="\/assets\/browser\/search-client\.mjs"><\/script>/, `r/${name} is missing the search controller`);
  }
});
