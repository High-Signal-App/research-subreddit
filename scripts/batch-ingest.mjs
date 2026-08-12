#!/usr/bin/env node
/**
 * Batch ingest — seed many subreddits in one run.
 *
 * Usage:
 *   node scripts/batch-ingest.mjs                    # all subreddits, posts-only deep
 *   node scripts/batch-ingest.mjs --with-comments    # also fetch comments (slow)
 *   node scripts/batch-ingest.mjs --list             # just list what would run
 *   node scripts/batch-ingest.mjs SaaS startups       # only specific subreddits
 *
 * Subreddits sourced from HiSignal's tracked community set.
 * Runs ingest sequentially to respect Reddit rate limits.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SUBREDDITS = [
  // AI / LLM / Dev
  "AI_Agents",
  "ClaudeAI",
  "OpenAI",
  "LocalLLaMA",
  "webdev",
  "devops",
  "ExperiencedDevs",
  "cscareerquestions",
  // Startup / Business
  "startups",
  "SaaS",
  "Entrepreneur",
  "indiehackers",
  "SideProject",
  "smallbusiness",
  // Marketing / Sales / Ecom
  "marketing",
  "sales",
  "ecommerce",
  "shopify",
  "EtsySellers",
  // Finance
  "personalfinance",
  "freelance",
  // Product / Infra
  "ProductManagement",
  "selfhosted",
  // India (HiSignal geo)
  "developersIndia",
  "india",
  // Jobs
  "jobs",
  // HiSignal geo + finance
  "Accounting",
  "PersonalFinanceCanada",
  "UKPersonalFinance",
  "bangalore",
  "bayarea",
  "delhi",
  "london",
  "mumbai",
  "nyc",
  "povertyfinance",
  "toronto",
  // Tech / Engineering
  "programming",
  "MachineLearning",
  "datascience",
  "artificial",
  "technology",
  "softwareengineering",
  "coding",
  "learnprogramming",
  "csMajors",
  "techcareers",
  "ITCareerQuestions",
  "dataengineering",
  "cloud",
  "cybersecurity",
  "node",
  // India (extended)
  "IndianStartups",
  "IndianInvestments",
  "IndianFreelancers",
  "IndiaPersonalFinance",
  "indiasocial",
  "IndianStreetBets",
];

const SCRIPTS_DIR = join(process.cwd(), "scripts");
const DATA_DIR = join(process.cwd(), "data", "reddit-memory");

const args = process.argv.slice(2);
const WITH_COMMENTS = args.includes("--with-comments");
const LIST_ONLY = args.includes("--list");
const CUSTOM = args.filter((a) => !a.startsWith("--"));

const targets = CUSTOM.length > 0 ? CUSTOM : SUBREDDITS;

if (LIST_ONLY) {
  console.log(`\n  Batch ingest — ${targets.length} subreddits (${WITH_COMMENTS ? "posts+comments" : "posts-only"})\n`);
  for (const sub of targets) {
    const file = join(DATA_DIR, `${sub}.json`);
    const exists = existsSync(file);
    let info = "";
    if (exists) {
      try {
        const data = JSON.parse(readFileSync(file, "utf8"));
        const posts = data.posts?.length ?? 0;
        const comments = data.posts?.reduce((s, p) => s + (p.comments?.length || 0), 0) ?? 0;
        const sizeMB = (statSync(file).size / 1024 / 1024).toFixed(1);
        info = `${posts} posts, ${comments} comments (${sizeMB} MB)`;
      } catch {
        info = "exists (unreadable)";
      }
    } else {
      info = "not yet ingested";
    }
    console.log(`  ${exists ? "✓" : "○"} r/${sub.padEnd(22)} ${info}`);
  }
  console.log();
  process.exit(0);
}

const flags = WITH_COMMENTS ? "--deep" : "--posts-only --deep";

console.log(`\n${"═".repeat(70)}`);
console.log(`  Batch ingest — ${targets.length} subreddits (${WITH_COMMENTS ? "posts+comments" : "posts-only"})`);
console.log(`${"═".repeat(70)}\n`);

let succeeded = 0;
let failed = 0;
const results = [];

for (let i = 0; i < targets.length; i++) {
  const sub = targets[i];
  const file = join(DATA_DIR, `${sub}.json`);

  // Skip if already has substantial data (unless --force)
  if (existsSync(file) && !args.includes("--force")) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      const posts = data.posts?.length ?? 0;
      if (posts > 100) {
        console.log(`  [${i + 1}/${targets.length}] r/${sub} — already has ${posts} posts, skipping (use --force to re-ingest)`);
        results.push({ sub, status: "skipped", posts });
        continue;
      }
    } catch {
      // file corrupt, re-ingest
    }
  }

  console.log(`\n  [${i + 1}/${targets.length}] Ingesting r/${sub}...`);
  console.log(`  ${"─".repeat(60)}`);

  try {
    execSync(
      `node ${join(SCRIPTS_DIR, "reddit-memory-ingest.mjs")} ${sub} new 10000 ${flags}`,
      { stdio: "inherit", cwd: process.cwd() }
    );
    succeeded++;

    // Read back the result
    let postCount = 0;
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, "utf8"));
        postCount = data.posts?.length ?? 0;
      } catch {}
    }
    results.push({ sub, status: "ok", posts: postCount });
  } catch (err) {
    console.error(`  FAILED: r/${sub} — ${err.message}`);
    failed++;
    results.push({ sub, status: "failed", error: err.message });
  }

  // Brief pause between subreddits to be gentle on rate limits
  if (i + 1 < targets.length) {
    console.log(`  (pausing 3s before next subreddit...)`);
    execSync("sleep 3");
  }
}

// Summary
console.log(`\n${"═".repeat(70)}`);
console.log(`  BATCH INGEST COMPLETE`);
console.log(`${"═".repeat(70)}\n`);
console.log(`  Succeeded: ${succeeded}`);
console.log(`  Failed:    ${failed}`);
console.log(`  Skipped:   ${results.filter((r) => r.status === "skipped").length}`);
console.log();

const sorted = results.sort((a, b) => (b.posts ?? 0) - (a.posts ?? 0));
for (const r of sorted) {
  const icon = r.status === "ok" ? "✓" : r.status === "skipped" ? "○" : "✗";
  const detail = r.posts != null ? `${r.posts} posts` : r.error ?? "";
  console.log(`  ${icon} r/${r.sub.padEnd(22)} ${r.status.padEnd(8)} ${detail}`);
}
console.log();

const totalPosts = results.reduce((s, r) => s + (r.posts ?? 0), 0);
console.log(`  Total posts across all subreddits: ${totalPosts}`);
console.log();
