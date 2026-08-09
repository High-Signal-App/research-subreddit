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
check(files.length === index.communities, `${index.communities} indexed communities have artifacts`);
check(index.communities > 0 && index.records > 0, "index contains communities and records");
check(Object.values(index.grades).reduce((sum, value) => sum + value, 0) === index.communities, "capability grades cover every community");

for (const file of files) {
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
console.log(`\n${files.length} compact community artifacts verified.`);
