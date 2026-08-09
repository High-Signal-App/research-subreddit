#!/usr/bin/env node
/**
 * Enrich Relevant Communities — prioritize and analyze raw subreddit corpora
 * using the repository's existing analyzer (reddit-memory-analyze.mjs).
 *
 * This runner does NOT ingest data, fetch comments, or touch the network. It only:
 *   1. discovers raw corpus JSON files in a data directory,
 *   2. ranks them by an explicit, editable relevance cohort + corpus readiness,
 *   3. runs the existing analyzer sequentially for the selected communities.
 *
 * Usage:
 *   node scripts/enrich-relevant-communities.mjs --list
 *   node scripts/enrich-relevant-communities.mjs --list --data-dir=/path/to/reddit-memory
 *   node scripts/enrich-relevant-communities.mjs --dry-run --limit=5
 *   node scripts/enrich-relevant-communities.mjs LocalLLaMA ChatGPT
 *   node scripts/enrich-relevant-communities.mjs --limit=10 --min-posts=500
 *   node scripts/enrich-relevant-communities.mjs --limit=3 --force
 *
 * Flags:
 *   --list                Dry run: print the ranked priority table and exit (no execution).
 *   --dry-run             Print the planned analyzer commands and exit (no execution).
 *   --data-dir=<path>     Corpus directory (default: <cwd>/data/reddit-memory).
 *   --limit=<N>           Only enrich the top N ranked communities.
 *   --min-posts=<N>       Skip communities with fewer than N posts.
 *   --force               Re-enrich even when a report already exists.
 *   --analyzer=<path>     Override analyzer script path (intended for tests).
 *
 * Safety:
 *   - Skips communities that already have a report (unless --force).
 *   - Continues after individual analyzer failures.
 *   - Refuses execution when --data-dir cannot be mapped to the analyzer's
 *     existing <cwd>/data/reddit-memory convention.
 *   - Never deletes files, fetches data, or writes outside --data-dir.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = dirname(__filename);
const REPO_ROOT = dirname(SCRIPTS_DIR);

// ─── Relevance cohort ─────────────────────────────────────────────────────
// EDIT THIS to change which communities are considered relevant and how
// strongly. `tier` is a priority band: 1 = highest relevance, 4 = lowest.
// Lower tier numbers rank earlier. Communities not listed here are ignored
// as enrichment candidates (they are not considered relevant).
//
// Cohorts: AI/LLM, developer infrastructure, product/startup, HiSignal-useful.
const RELEVANCE_COHORT = {
  // ── AI / LLM (HiSignal core) ──
  AI_Agents:         { tier: 1, reason: "Agent frameworks — HiSignal core" },
  LocalLLaMA:        { tier: 1, reason: "Local LLM inference — HiSignal core" },
  ChatGPT:           { tier: 1, reason: "LLM usage + prompt patterns" },
  ClaudeAI:          { tier: 1, reason: "LLM usage + agent workflows" },
  OpenAI:            { tier: 1, reason: "LLM platform + API usage" },
  MachineLearning:   { tier: 2, reason: "ML research / model training" },
  MLOps:             { tier: 2, reason: "ML infrastructure + deployment" },
  artificial:        { tier: 2, reason: "AI news + discourse" },
  StableDiffusion:   { tier: 2, reason: "Generative image models" },
  dataengineering:   { tier: 2, reason: "Data infra + pipelines" },
  singularity:       { tier: 3, reason: "AI futures (adjacent)" },
  midjourney:        { tier: 3, reason: "Generative image usage" },
  computervision:    { tier: 3, reason: "CV research" },
  deeplearning:      { tier: 3, reason: "DL research" },
  datascience:       { tier: 3, reason: "Analytics (adjacent to infra)" },

  // ── Developer infrastructure ──
  devops:              { tier: 2, reason: "Infra / CI-CD / deployment" },
  cloud:               { tier: 2, reason: "Cloud infrastructure" },
  softwareengineering: { tier: 2, reason: "Software engineering practice" },
  ExperiencedDevs:     { tier: 2, reason: "Senior eng practice" },
  cybersecurity:       { tier: 3, reason: "Security operations" },
  selfhosted:          { tier: 3, reason: "Self-hosted infrastructure" },
  programming:         { tier: 3, reason: "General development" },
  coding:              { tier: 3, reason: "General development" },
  cscareerquestions:   { tier: 3, reason: "Engineering careers" },
  techcareers:         { tier: 3, reason: "Tech careers" },

  // ── Languages / frameworks ──
  javascript:      { tier: 3, reason: "JS ecosystem" },
  node:            { tier: 3, reason: "Node ecosystem" },
  reactjs:         { tier: 3, reason: "Frontend framework" },
  python:          { tier: 3, reason: "Python ecosystem" },
  rust:            { tier: 3, reason: "Rust ecosystem" },
  golang:          { tier: 3, reason: "Go ecosystem" },
  webdev:          { tier: 4, reason: "Web development" },
  vuejs:           { tier: 4, reason: "Frontend framework" },
  sveltejs:        { tier: 4, reason: "Frontend framework" },
  angular:         { tier: 4, reason: "Frontend framework" },
  django:          { tier: 4, reason: "Python web framework" },
  laravel:         { tier: 4, reason: "PHP web framework" },
  rails:           { tier: 4, reason: "Ruby web framework" },
  flutterdev:      { tier: 4, reason: "Cross-platform mobile" },
  iOSProgramming:  { tier: 4, reason: "iOS development" },
  androiddev:      { tier: 4, reason: "Android development" },
  gamedev:         { tier: 4, reason: "Game development" },
  developersIndia: { tier: 4, reason: "India developer community" },

  // ── Product / startup ──
  Entrepreneur:         { tier: 2, reason: "Startup founders" },
  startups:             { tier: 2, reason: "Startup ecosystem" },
  SaaS:                 { tier: 2, reason: "SaaS business" },
  ProductManagement:    { tier: 2, reason: "Product practice" },
  indiehackers:         { tier: 3, reason: "Indie founders" },
  SideProject:          { tier: 3, reason: "Side projects" },
  Business_Ideas:       { tier: 3, reason: "Startup ideas" },
  smallbusiness:        { tier: 3, reason: "SMB operations" },
  EntrepreneurRideAlong:{ tier: 3, reason: "Founder journeys" },
  marketing:            { tier: 3, reason: "Growth / marketing" },
  sales:                { tier: 3, reason: "Sales practice" },
  freelance:            { tier: 4, reason: "Freelance business" },
  ecommerce:            { tier: 4, reason: "Ecommerce" },
  shopify:              { tier: 4, reason: "Ecommerce platform" },
  dropshipping:         { tier: 4, reason: "Ecommerce ops" },
  EtsySellers:          { tier: 4, reason: "Ecommerce sellers" },
  recruiting:           { tier: 4, reason: "Hiring" },
  jobs:                 { tier: 4, reason: "Job market" },
  jobsearch:            { tier: 4, reason: "Job search" },
  csMajors:             { tier: 4, reason: "CS students" },
};

const MAX_TIER = Math.max(...Object.values(RELEVANCE_COHORT).map(c => c.tier));

// Files in the data dir that are NOT raw corpora.
const EXCLUDE_SUFFIXES = ["-high-signal.json", "-report.json", "-report.html", "-anchors.json"];
const EXCLUDE_GLOBS = ["-report-", "-embeddings.json"]; // -report-<N>d.json, cache entries by name
const CACHE_DIR_NAME = "cache";

// ─── CLI parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    list: false,
    dryRun: false,
    dataDir: join(REPO_ROOT, "data", "reddit-memory"),
    limit: null,
    minPosts: 0,
    force: false,
    analyzer: join(SCRIPTS_DIR, "reddit-memory-analyze.mjs"),
    subreddits: [],
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--list") opts.list = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--force") opts.force = true;
    else if (arg.startsWith("--data-dir=")) opts.dataDir = resolve(arg.slice("--data-dir=".length));
    else if (arg.startsWith("--limit=")) opts.limit = parseInt(arg.slice("--limit=".length), 10);
    else if (arg.startsWith("--min-posts=")) opts.minPosts = parseInt(arg.slice("--min-posts=".length), 10);
    else if (arg.startsWith("--analyzer=")) opts.analyzer = resolve(arg.slice("--analyzer=".length));
    else if (arg.startsWith("--")) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    } else {
      opts.subreddits.push(arg);
    }
  }
  if(opts.limit!==null&&(!Number.isInteger(opts.limit)||opts.limit<1)){console.error("--limit must be a positive integer");process.exit(2)}
  if(!Number.isInteger(opts.minPosts)||opts.minPosts<0){console.error("--min-posts must be a non-negative integer");process.exit(2)}
  return opts;
}

// ─── Corpus discovery + readiness ─────────────────────────────────────────

function isRawCorpus(name) {
  if (!name.endsWith(".json")) return false;
  if (EXCLUDE_SUFFIXES.some(s => name.endsWith(s))) return false;
  if (EXCLUDE_GLOBS.some(g => name.includes(g))) return false;
  return true;
}

function monthKey(tsMs) {
  const d = new Date(tsMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function assessCorpus(filePath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e) {
    return { error: `unreadable JSON: ${e.message}` };
  }
  const posts = Array.isArray(raw.posts) ? raw.posts
    : Array.isArray(raw.items) ? raw.items
    : Array.isArray(raw.data) ? raw.data
    : [];
  let withBody = 0;
  const months = new Set();
  let minTs = Infinity, maxTs = -Infinity;
  for (const p of posts) {
    const body = (p.selftext || p.body || "").trim();
    if (body && !/^\[(removed|deleted)\]$/i.test(body)) withBody++;
    const ts = p.created_utc != null ? p.created_utc : p.created;
    if (typeof ts === "number" && ts > 0) {
      minTs = Math.min(minTs, ts);
      maxTs = Math.max(maxTs, ts);
      months.add(monthKey(ts * 1000));
    }
  }
  const n = posts.length;
  const bodyCoverage = n > 0 ? withBody / n : 0;
  const representedMonths = months.size;
  const dateRange = (minTs === Infinity || maxTs === -Infinity)
    ? null
    : { start: new Date(minTs * 1000).toISOString().slice(0, 10), end: new Date(maxTs * 1000).toISOString().slice(0, 10) };
  return { n, withBody, bodyCoverage, representedMonths, dateRange };
}

// readinessScore: 0..100 — how much usable signal the corpus holds.
function readinessScore(a) {
  if (a.error) return 0;
  const postsScore = Math.min(a.n, 2000) / 2000 * 30;          // max 30
  const bodyScore = a.bodyCoverage * 40;                        // max 40
  const monthsScore = Math.min(a.representedMonths, 60) / 60 * 30; // max 30
  return postsScore + bodyScore + monthsScore;
}

// rankScore: cohort tier dominates; readiness breaks ties within a tier.
function rankScore(cohort, a) {
  const tierWeight = (MAX_TIER - cohort.tier + 1); // tier 1 -> MAX_TIER
  return tierWeight * 1000 + readinessScore(a);
}

function discoverCandidates(dataDir) {
  let entries;
  try {
    entries = readdirSync(dataDir, { withFileTypes: true });
  } catch (e) {
    return { candidates: [], totalRaw: 0, nonCohort: 0, error: `cannot read data dir: ${e.message}` };
  }
  const candidates = [];
  let totalRaw = 0;
  let nonCohort = 0;
  for (const ent of entries) {
    if (ent.isDirectory()) continue; // skips cache/ and any subdirectory
    if (!isRawCorpus(ent.name)) continue;
    totalRaw++;
    const subreddit = ent.name.replace(/\.json$/, "");
    const cohort = RELEVANCE_COHORT[subreddit];
    if (!cohort) { nonCohort++; continue; }
    const assessment = assessCorpus(join(dataDir, ent.name));
    const reportPath = join(dataDir, `${subreddit}-report.json`);
    const hasReport = existsSync(reportPath);
    candidates.push({
      subreddit,
      tier: cohort.tier,
      reason: cohort.reason,
      assessment,
      readiness: readinessScore(assessment),
      score: rankScore(cohort, assessment),
      hasReport,
      reportPath,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.subreddit.localeCompare(b.subreddit));
  return { candidates, totalRaw, nonCohort };
}

function applyFilters(candidates, opts) {
  let list = candidates.slice();
  if (opts.subreddits.length) {
    const wanted = new Set(opts.subreddits);
    list = list.filter(c => wanted.has(c.subreddit));
    // Also surface unknown-but-requested subreddits explicitly.
    for (const s of opts.subreddits) {
      if (!candidates.some(c => c.subreddit === s) && RELEVANCE_COHORT[s]) {
        list.push({ subreddit: s, tier: RELEVANCE_COHORT[s].tier, reason: RELEVANCE_COHORT[s].reason, assessment: { error: "no corpus file found" }, readiness: 0, score: -1, hasReport: false, reportPath: join(opts.dataDir, `${s}-report.json`), missing: true });
      }
    }
  }
  if (opts.minPosts > 0) {
    list = list.filter(c => !c.assessment.error && c.assessment.n >= opts.minPosts);
  }
  if (opts.limit != null && !opts.subreddits.length) {
    list = list.slice(0, opts.limit);
  }
  return list;
}

// ─── Execution ────────────────────────────────────────────────────────────

// The analyzer hardcodes `join(process.cwd(), "data", "reddit-memory")`.
// To point it at --data-dir we run it with cwd = X where X/data/reddit-memory === dataDir.
function analyzerCwdFor(dataDir) {
  const expected = join("data", "reddit-memory");
  const abs = resolve(dataDir);
  const norm = abs.split(sep).filter(Boolean);
  const tail = norm.slice(-2).join("/");
  if (tail !== expected) return null;
  const parent = norm.slice(0, -2).join(sep);
  return (abs.startsWith(sep) ? sep : "") + parent;
}

function runAnalyzer(analyzerPath, subreddit, cwd) {
  const res = spawnSync("node", [analyzerPath, subreddit], { stdio: "inherit", cwd });
  return res.status === 0;
}

// ─── Output ───────────────────────────────────────────────────────────────

function fmtPct(x) { return (x * 100).toFixed(0) + "%"; }

function printList(selected, meta, opts) {
  console.log(`Data dir: ${opts.dataDir}`);
  console.log(`Raw corpora: ${meta.totalRaw} | cohort candidates: ${meta.candidates.length} | non-cohort (ignored): ${meta.nonCohort}`);
  if (meta.error) console.log(`(discovery error: ${meta.error})`);
  console.log("");
  if (!selected.length) {
    console.log("No matching cohort candidates.");
    return;
  }
  const rows = selected.map((c, i) => {
    const a = c.assessment;
    const ready = a.error
      ? `ERR: ${a.error}`
      : `${a.n} posts, ${fmtPct(a.bodyCoverage)} body, ${a.representedMonths} mo`;
    const range = a.dateRange ? `${a.dateRange.start}→${a.dateRange.end}` : "—";
    const status = c.hasReport ? "report exists" : c.missing ? "no corpus" : "raw";
    return `#${String(i + 1).padStart(2)}  r/${c.subreddit.padEnd(22)} T${c.tier}  score ${c.score.toFixed(0).padStart(4)}  ${ready.padEnd(34)} ${range.padEnd(21)} ${status}`;
  });
  console.log("Rank  Subreddit                Tier  Score   Readiness                         Date range            Status");
  console.log(rows.join("\n"));
  console.log("");
  console.log("Tier: 1=highest relevance. Score = tierWeight*1000 + readiness(0..100). Status 'raw' = ready to enrich.");
}

function main() {
  const opts = parseArgs(process.argv);
  const meta = discoverCandidates(opts.dataDir);
  const selected = applyFilters(meta.candidates, opts);

  if (opts.list) {
    printList(selected, meta, opts);
    return;
  }

  if (!selected.length) {
    console.error("No communities selected. Use --list to inspect the ranking.");
    process.exit(1);
  }

  // Determine what to actually run.
  const plan = selected.filter(c => !c.assessment.error && !c.missing);
  const toRun = opts.force ? plan : plan.filter(c => !c.hasReport);
  const skipped = plan.filter(c => c.hasReport && !opts.force);

  if (opts.dryRun) {
    console.log(`Dry run — ${toRun.length} to enrich, ${skipped.length} skipped (existing report).`);
    const cwd = analyzerCwdFor(opts.dataDir);
    for (const c of toRun) {
      const runCwd = cwd ?? REPO_ROOT;
      console.log(`  [cwd ${runCwd}] node ${opts.analyzer} ${c.subreddit}`);
    }
    if (cwd == null) {
      console.log(`  NOTE: --data-dir does not end in data/reddit-memory; execution would fall back to repo root and may not find corpora.`);
    }
    return;
  }

  const cwd = analyzerCwdFor(opts.dataDir);
  if (cwd == null) {
    console.error(
      `Cannot execute: --data-dir must end in "data/reddit-memory" so the analyzer can locate it\n` +
      `(the analyzer reads <cwd>/data/reddit-memory/<sub>.json). Got: ${opts.dataDir}\n` +
      `Use --list to audit, or point --data-dir at a writable "data/reddit-memory" directory.`
    );
    process.exit(1);
  }

  if (!toRun.length) {
    console.log(`Nothing to enrich — ${skipped.length} already have reports (use --force to re-enrich).`);
    return;
  }

  console.log(`Enriching ${toRun.length} community(ies) into ${opts.dataDir} (cwd ${cwd})\n`);
  const results = [];
  for (const c of toRun) {
    const label = `r/${c.subreddit}`;
    process.stdout.write(`\n=== ${label} (tier ${c.tier}, ${c.assessment.n} posts) ===\n`);
    const ok = runAnalyzer(opts.analyzer, c.subreddit, cwd);
    results.push({ subreddit: c.subreddit, ok });
    if (!ok) console.error(`  FAILED: ${label} — continuing.`);
  }

  console.log("\n=== SUMMARY ===");
  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  console.log(`Enriched: ${ok.length}  Failed: ${fail.length}  Skipped (existing): ${skipped.length}`);
  if (fail.length) console.log(`Failed: ${fail.map(r => r.subreddit).join(", ")}`);
  if (skipped.length) console.log(`Skipped: ${skipped.map(c => c.subreddit).join(", ")}`);
  console.log(`Reports written under: ${opts.dataDir}`);
  if (fail.length) process.exit(1);
}

main();
