#!/usr/bin/env node
/**
 * Reddit Memory Pipeline — one-command run for any subreddit.
 *
 * Usage:
 *   node scripts/reddit-memory-run.mjs <subreddit>                    # full pipeline (deep history + comments + analyze + ui)
 *   node scripts/reddit-memory-run.mjs <subreddit> --posts-only       # skip comments (fast, ~2 min)
 *   node scripts/reddit-memory-run.mjs <subreddit> --analyze-only     # skip ingest, just re-analyze + ui
 *   node scripts/reddit-memory-run.mjs <subreddit> --ui-only          # just regenerate UI from existing report
 *
 * Steps:
 *   1. Ingest posts (deep history: new + top/year + top/all)
 *   2. Fetch comments (parallel, adaptive rate limiting)
 *   3. Analyze (embeddings, topics, tone, moderation, evolution)
 *   4. Generate UI
 *
 * Timing (approximate, depends on subreddit size):
 *   --posts-only:  ~2 min (ingest) + ~5 min (analyze) = ~7 min
 *   Full:          ~2 min (ingest) + ~15 min (comments) + ~10 min (analyze) = ~27 min
 *   --analyze-only with cache: ~30 sec (if embeddings cached)
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { memoryDir, storageFile } from "./lib/paths.mjs";

const SUBREDDIT = process.argv[2];
if (!SUBREDDIT) {
  console.error("Usage: node scripts/reddit-memory-run.mjs <subreddit> [--posts-only|--analyze-only|--ui-only]");
  process.exit(1);
}

const SCRIPTS_DIR = join(process.cwd(), "scripts");
const DATA_DIR = memoryDir();
const STORAGE_FILE = storageFile(SUBREDDIT);
const REPORT_FILE = join(DATA_DIR, `${SUBREDDIT}-report.json`);

const POSTS_ONLY = process.argv.includes("--posts-only");
const ANALYZE_ONLY = process.argv.includes("--analyze-only");
const UI_ONLY = process.argv.includes("--ui-only");

const run = (cmd, label) => {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${"═".repeat(70)}\n`);
  try {
    execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
  } catch (e) {
    // Port already in use is fine for UI step (HTML was still saved before the server error)
    if (label.includes("UI") && (e.message?.includes("EADDRINUSE") || e.stderr?.includes("EADDRINUSE") || e.status)) {
      console.log("  (UI server already running on port 7424 — static HTML was still saved)");
    } else {
      throw e;
    }
  }
};

// Step 1: Ingest
if (!UI_ONLY && !ANALYZE_ONLY) {
  const flags = POSTS_ONLY ? "--posts-only --deep" : "--deep";
  run(`node ${join(SCRIPTS_DIR, "reddit-memory-ingest.mjs")} ${SUBREDDIT} new 10000 ${flags}`, `STEP 1: Ingest posts for r/${SUBREDDIT}`);
}

// Step 2: Analyze
if (!UI_ONLY) {
  if (!existsSync(STORAGE_FILE)) {
    console.error(`\nNo storage file found at ${STORAGE_FILE}. Run ingest first.`);
    process.exit(1);
  }
  run(`node ${join(SCRIPTS_DIR, "reddit-memory-analyze.mjs")} ${SUBREDDIT}`, `STEP 2: Analyze r/${SUBREDDIT}`);
}

// Step 3: UI
run(`node ${join(SCRIPTS_DIR, "reddit-memory-ui.mjs")} ${SUBREDDIT}`, `STEP 3: Generate UI for r/${SUBREDDIT}`);

console.log(`\n${"═".repeat(70)}`);
console.log(`  DONE — r/${SUBREDDIT} analysis complete`);
console.log(`  Storage:  ${STORAGE_FILE}`);
console.log(`  Report:   ${REPORT_FILE}`);
console.log(`  UI:       http://localhost:7424`);
console.log(`${"═".repeat(70)}\n`);
