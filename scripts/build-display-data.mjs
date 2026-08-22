#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_DIR = join(ROOT, "data", "reddit-memory");
const OUTPUT_DIR = join(ROOT, "data", "reddit-display");
const SCHEMA = "reddit-insights.display.v1";

function isCorpus(file) {
  return file.endsWith(".json") && !file.includes("-report") && !file.includes("-high-signal") && !file.includes("-anchors");
}

function canonicalKey(post) {
  return String(post?.id || post?.permalink || "").trim();
}

function topicLabel(topic) {
  if (typeof topic === "string") return topic;
  return topic?.topic || "";
}

function enrichedTopics(subreddit) {
  const path = join(SOURCE_DIR, `${subreddit}-report.json`);
  if (!existsSync(path)) return new Map();
  const report = JSON.parse(readFileSync(path, "utf8"));
  return new Map((report.engagementScatter || []).flatMap(post => {
    const key = canonicalKey(post);
    const topic = topicLabel(post.topic);
    return key && topic && topic !== "Unclassified" ? [[key, topic]] : [];
  }));
}

function compactPost(post, topics) {
  const key = canonicalKey(post);
  const body = String(post.selftext || post.body || "").trim();
  const topic = topics.get(key) || topicLabel(post.topic);
  return {
    id: String(post.id || ""),
    permalink: String(post.permalink || ""),
    title: String(post.title || "Untitled post").slice(0, 500),
    selftext: body.slice(0, 1600),
    score: Number(post.score ?? post.ups ?? 0),
    num_comments: Number(post.num_comments ?? 0),
    upvote_ratio: Number(post.upvote_ratio ?? 0),
    link_flair_text: String(post.link_flair_text || ""),
    created_utc: Number(post.created_utc ?? post.created ?? 0),
    ...(topic && topic !== "Unclassified" ? { topic } : {}),
  };
}

function capability(postCount) {
  const canonRecords = Math.max(0, postCount - 1000);
  if (postCount >= 1500 && canonRecords >= 500) {
    return { grade: "strong", canonRecords, summary: "Core canon, contender, language, format, and response views available." };
  }
  if (postCount >= 500) {
    return { grade: "limited", canonRecords, summary: "Recent-pool views are useful; historical canon interpretation is limited." };
  }
  return { grade: "sparse", canonRecords, summary: "Source and recent-pattern exploration only; historical comparison is withheld." };
}

function main() {
  const files = readdirSync(SOURCE_DIR).filter(isCorpus).sort((a, b) => a.localeCompare(b));
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const rows = [];
  const skipped = [];
  for (const file of files) {
    const sourcePath = join(SOURCE_DIR, file);
    try {
      const payload = JSON.parse(readFileSync(sourcePath, "utf8"));
      const rawPosts = Array.isArray(payload) ? payload : (payload.posts || []);
      const subreddit = payload.subreddit || file.slice(0, -5);
      const topics = enrichedTopics(subreddit);
      const posts = rawPosts.map(post => compactPost(post, topics)).filter(post => post.created_utc > 0);
      const coverage = capability(posts.length);
      const artifact = {
        schema: SCHEMA,
        subreddit,
        generatedFrom: payload.lastUpdated ? new Date(payload.lastUpdated).toISOString() : null,
        coverage: { ...coverage, totalRecords: posts.length, topicAssignedRecords: posts.filter(post => post.topic).length },
        posts,
      };
      const outputPath = join(OUTPUT_DIR, `${subreddit}.json.gz`);
      writeFileSync(outputPath, gzipSync(JSON.stringify(artifact), { level: 9 }));
      rows.push({ sortKey: file, subreddit, records: posts.length, grade: coverage.grade, topics: artifact.coverage.topicAssignedRecords, bytes: statSync(outputPath).size });
    } catch (error) {
      skipped.push({ file, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  // The index defines the published set. An artifact whose raw corpus is no
  // longer on this machine cannot be regenerated or verified, so it stays
  // unpublished and named here. The file itself is left on disk untouched —
  // it may be the last local copy of that corpus — and republishes by itself
  // once the raw corpus is collected again.
  const generated = new Set(rows.map(row => `${row.subreddit}.json.gz`));
  const unpublished = readdirSync(OUTPUT_DIR)
    .filter(name => name.endsWith(".json.gz") && !generated.has(name))
    .sort((a, b) => a.localeCompare(b))
    .map(file => ({
      file,
      subreddit: file.slice(0, -8),
      bytes: statSync(join(OUTPUT_DIR, file)).size,
      reason: "unpublished: no raw corpus for this artifact on this machine",
    }));
  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  for (const row of rows) delete row.sortKey;
  const summary = {
    schema: SCHEMA,
    communities: rows.length,
    records: rows.reduce((sum, row) => sum + row.records, 0),
    bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    grades: Object.fromEntries(["strong", "limited", "sparse"].map(grade => [grade, rows.filter(row => row.grade === grade).length])),
    topicEnriched: rows.filter(row => row.topics > 0).length,
    skipped,
    unpublished,
    rows,
  };
  writeFileSync(join(OUTPUT_DIR, "index.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ communities: summary.communities, records: summary.records, grades: summary.grades, topicEnriched: summary.topicEnriched, sizeMB: Number((summary.bytes / 1048576).toFixed(1)), skipped, unpublished }, null, 2));
}

main();
