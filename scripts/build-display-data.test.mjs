#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const DIR = join(process.cwd(), "data", "reddit-display");
const index = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8"));
const files = readdirSync(DIR).filter(file => file.endsWith(".json.gz"));
const allowed = new Set(["id", "permalink", "title", "selftext", "score", "num_comments", "upvote_ratio", "link_flair_text", "created_utc", "topic"]);
let failures = 0;

function check(condition, message) {
  if (condition) console.log(`PASS  ${message}`);
  else { console.error(`FAIL  ${message}`); failures++; }
}

check(index.schema === "reddit-insights.display.v1", "index schema is versioned");
check(index.communities > 0 && index.records > 0, "index contains communities and records");
check(Object.values(index.grades).reduce((sum, value) => sum + value, 0) === index.communities, "capability grades cover every community");

// Coverage accounting: the index defines the published set, and every artifact
// on disk is either published or named as unpublished — never silently missing.
check(Array.isArray(index.skipped), "index reports skipped corpora");
check(Array.isArray(index.unpublished), "index reports unpublished artifacts");
check(index.rows.length === index.communities, "every indexed community has a row");
check(files.length === index.communities + index.unpublished.length, `${files.length} artifacts split into ${index.communities} published and ${index.unpublished.length} unpublished`);
check(index.skipped.every(entry => entry.file && entry.reason), "each skipped corpus names a file and a reason");
check(index.unpublished.every(entry => entry.file && entry.subreddit && entry.reason), "each unpublished artifact names its community and reason");
const published = new Set(index.rows.map(row => row.subreddit));
check(index.unpublished.every(entry => !published.has(entry.subreddit)), "no unpublished artifact is also published");
for (const entry of index.unpublished) console.log(`NOTE  r/${entry.subreddit} unpublished — no local raw corpus (${(entry.bytes / 1024).toFixed(0)} KB artifact kept on disk)`);

for (const file of files.filter(name => !index.unpublished.some(entry => entry.file === name))) {
  const artifact = JSON.parse(gunzipSync(readFileSync(join(DIR, file))).toString("utf8"));
  check(artifact.schema === index.schema, `${artifact.subreddit} uses display schema`);
  check(Array.isArray(artifact.posts) && artifact.posts.length === artifact.coverage.totalRecords, `${artifact.subreddit} record count reconciles`);
  check(["strong", "limited", "sparse"].includes(artifact.coverage.grade), `${artifact.subreddit} has a valid capability grade`);
  const unexpected = new Set(artifact.posts.flatMap(post => Object.keys(post).filter(key => !allowed.has(key))));
  check(unexpected.size === 0, `${artifact.subreddit} omits unused Reddit fields`);
  check(artifact.posts.every(post => post.selftext.length <= 1600 && post.title.length <= 500), `${artifact.subreddit} text bounds hold`);
  check(statSync(join(DIR, file)).size < 10 * 1024 * 1024, `${artifact.subreddit} artifact stays below 10 MB`);
}

if (failures) process.exit(1);
console.log(`\n${index.communities} published community artifacts verified; ${index.unpublished.length} unpublished.`);
