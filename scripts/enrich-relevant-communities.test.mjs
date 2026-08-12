#!/usr/bin/env node
/**
 * Focused tests for enrich-relevant-communities.mjs.
 *
 * No network or models. Uses a temporary fixture data dir and a fake analyzer
 * script that records the subreddits it was asked to analyze.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = dirname(__filename);
const RUNNER = join(SCRIPTS_DIR, "enrich-relevant-communities.mjs");

let passed = 0, failed = 0;
function ok(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

function run(args, cwd) {
  const res = spawnSync("node", [RUNNER, ...args], { cwd: cwd ?? process.cwd(), encoding: "utf8" });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

function makeCorpus(sub, n, { bodyRate = 0.8, months = 12, startTs = 1_600_000_000 } = {}) {
  const posts = [];
  for (let i = 0; i < n; i++) {
    const ts = startTs + Math.floor(i / Math.max(1, n / months)) * 2629800;
    posts.push({
      id: `${sub}_${i}`,
      title: `${sub} post ${i}`,
      selftext: i / n < bodyRate ? `body text ${i} `.repeat(5) : "",
      created_utc: ts,
      num_comments: i,
    });
  }
  return { subreddit: sub, lastUpdated: Date.now(), posts };
}

// Build a fake analyzer that appends the subreddit it received to a log file,
// then writes a <sub>-report.json so the "skip existing" path can be tested.
function makeFakeAnalyzer(logPath) {
  return `#!/usr/bin/env node
import { writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
const sub = process.argv[2];
const dataDir = join(process.cwd(), "data", "reddit-memory");
appendFileSync(${JSON.stringify(logPath)}, sub + "\\n");
if (sub === "coding") process.exit(7);
writeFileSync(join(dataDir, sub + "-report.json"), JSON.stringify({ subreddit: sub, ok: true }));
console.log("fake-analyzed " + sub);
`;
}

// Set up a temp repo-like tree: <tmp>/repo/data/reddit-memory
const TMP = mkdtempSync(join(tmpdir(), "enrich-test-"));
const REPO = join(TMP, "repo");
const DATA = join(REPO, "data", "reddit-memory");
mkdirSync(DATA, { recursive: true });
const FAKE = join(TMP, "fake-analyzer.mjs");
const LOG = join(TMP, "analyzer.log");
writeFileSync(FAKE, makeFakeAnalyzer(LOG));

function cleanup() {
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
}
process.on("exit", cleanup);

// Seed corpora: two cohort members (LocalLLaMA tier1, devops tier2),
// one cohort member with tiny post count, one non-cohort, plus excluded artifacts.
writeFileSync(join(DATA, "LocalLLaMA.json"), JSON.stringify(makeCorpus("LocalLLaMA", 500, { bodyRate: 0.9, months: 24 })));
writeFileSync(join(DATA, "devops.json"), JSON.stringify(makeCorpus("devops", 300, { bodyRate: 0.5, months: 10 })));
writeFileSync(join(DATA, "SideProject.json"), JSON.stringify(makeCorpus("SideProject", 5, { bodyRate: 1, months: 1 })));
writeFileSync(join(DATA, "austin.json"), JSON.stringify(makeCorpus("austin", 1000))); // non-cohort -> ignored
writeFileSync(join(DATA, "LocalLLaMA-high-signal.json"), "[]"); // excluded
writeFileSync(join(DATA, "LocalLLaMA-report.json"), '{"x":1}'); // excluded + existing report marker
writeFileSync(join(DATA, "LocalLLaMA-anchors.json"), "{}"); // excluded
mkdirSync(join(DATA, "cache"), { recursive: true });
writeFileSync(join(DATA, "cache", "LocalLLaMA-embeddings.json"), "{}"); // excluded (dir)

console.log("\n— Test: --list ranks cohort members and excludes non-cohort/artifacts —");
{
  const r = run(["--list", `--data-dir=${DATA}`]);
  ok("list exits 0", r.status === 0, r.stderr);
  ok("LocalLLaMA ranked #1 (tier1)", /#\s*1\s+r\/LocalLLaMA\s+T1/.test(r.stdout), r.stdout.split("\n").find(l => l.includes("LocalLLaMA")));
  ok("devops appears (tier2)", /r\/devops\s+T2/.test(r.stdout), r.stdout);
  ok("non-cohort austin absent", !r.stdout.includes("r/austin"), "austin should be ignored");
  ok("high-signal/report/anchors absent", !r.stdout.includes("high-signal") && !r.stdout.includes("-report") && !r.stdout.includes("anchors"));
  ok("reports raw corpora + non-cohort counts", /Raw corpora: 4/.test(r.stdout), r.stdout);
  ok("LocalLLaMA shows 'report exists'", /r\/LocalLLaMA.*report exists/.test(r.stdout), r.stdout);
  ok("devops shows 'raw'", /r\/devops.*raw/.test(r.stdout), r.stdout);
}

console.log("\n— Test: --min-posts filters small corpora —");
{
  const r = run(["--list", `--data-dir=${DATA}`, "--min-posts=100"]);
  ok("SideProject (5 posts) filtered out", !r.stdout.includes("SideProject"), r.stdout);
  ok("LocalLLaMA + devops remain", r.stdout.includes("LocalLLaMA") && r.stdout.includes("devops"));
}

console.log("\n— Test: --dry-run prints commands, writes nothing —");
{
  const r = run(["--dry-run", `--data-dir=${DATA}`, "--analyzer=" + FAKE]);
  ok("dry-run exits 0", r.status === 0, r.stderr);
  ok("mentions devops command", /node .*fake-analyzer\.mjs devops/.test(r.stdout), r.stdout);
  ok("LocalLLaMA skipped (existing report)", /skipped/i.test(r.stdout), r.stdout);
  ok("no report written by dry-run", !existsSync(join(DATA, "devops-report.json")));
  ok("analyzer log untouched", !existsSync(LOG) || readFileSync(LOG, "utf8").trim() === "");
}

console.log("\n— Test: execution enriches only raw, skips existing, continues on failure —");
{
  // Reset: remove any prior devops report from dry-run (none expected) and log.
  try { rmSync(LOG, { force: true }); } catch {}
  try { rmSync(join(DATA, "devops-report.json"), { force: true }); } catch {}
  // Add a valid cohort corpus whose fake analyzer intentionally fails.
  writeFileSync(join(DATA, "coding.json"), JSON.stringify(makeCorpus("coding", 200, { bodyRate: .8, months: 8 })));
  const r = run(["--analyzer=" + FAKE, `--data-dir=${DATA}`], REPO);
  ok("returns failure after continuing", r.status === 1, "status=" + r.status + " stderr=" + r.stderr);
  ok("devops report written", existsSync(join(DATA, "devops-report.json")));
  ok("LocalLLaMA skipped (already had report)", !readFileSync(LOG, "utf8").includes("LocalLLaMA"), readFileSync(LOG, "utf8"));
  ok("coding failure reported after devops ran", r.stdout.includes("coding") && r.stderr.includes("FAILED"), `${r.stdout}\n${r.stderr}`);
  // clean up coding.json so later tests are stable
  try { rmSync(join(DATA, "coding.json"), { force: true }); } catch {}
}

console.log("\n— Test: --force re-enriches even when a report exists —");
{
  try { rmSync(LOG, { force: true }); } catch {}
  const r = run(["--force", "--limit=1", `--data-dir=${DATA}`, "--analyzer=" + FAKE], REPO);
  ok("force exits 0", r.status === 0, r.stderr);
  ok("LocalLLaMA re-analyzed (top of ranking)", readFileSync(LOG, "utf8").includes("LocalLLaMA"), readFileSync(LOG, "utf8"));
}

console.log("\n— Test: explicit subreddit args select regardless of rank —");
{
  try { rmSync(LOG, { force: true }); } catch {}
  try { rmSync(join(DATA, "devops-report.json"), { force: true }); } catch {}
  const r = run(["devops", `--data-dir=${DATA}`, "--analyzer=" + FAKE], REPO);
  ok("explicit devops analyzed", readFileSync(LOG, "utf8").trim() === "devops", readFileSync(LOG, "utf8"));
  ok("LocalLLaMA not touched (not requested, has report)", !readFileSync(LOG, "utf8").includes("LocalLLaMA"));
}

console.log("\n— Test: validates numeric flags —");
{
  const badLimit = run(["--list", "--limit=nope", `--data-dir=${DATA}`], REPO);
  const badMinimum = run(["--list", "--min-posts=-1", `--data-dir=${DATA}`], REPO);
  ok("invalid limit rejected", badLimit.status === 2 && /positive integer/.test(badLimit.stderr), badLimit.stderr);
  ok("negative minimum rejected", badMinimum.status === 2 && /non-negative integer/.test(badMinimum.stderr), badMinimum.stderr);
}

console.log("\n— Test: refuses to execute when data-dir breaks analyzer cwd convention —");
{
  const weird = mkdtempSync(join(tmpdir(), "weird-"));
  writeFileSync(join(weird, "LocalLLaMA.json"), JSON.stringify(makeCorpus("LocalLLaMA", 10)));
  const r = run(["--limit=1", `--data-dir=${weird}`, "--analyzer=" + FAKE], REPO);
  ok("execution refused for non-conforming data-dir", r.status === 1 && /data\/reddit-memory/.test(r.stderr), "status=" + r.status + " stderr=" + r.stderr);
  try { rmSync(weird, { recursive: true, force: true }); } catch {}
}

console.log(`\n=== TESTS: ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
