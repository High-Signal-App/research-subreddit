#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DISPLAY_DIR = join(ROOT, "data", "reddit-display");
const DIST_DIR = join(ROOT, "dist");
const INDEX_FILE = join(DISPLAY_DIR, "index.json");
const ROSTER_FILE = join(ROOT, "config", "community-roster.json");
const PORT = 17424;

if (!existsSync(INDEX_FILE)) {
  throw new Error("Missing compact display index. Run npm run build:display first.");
}
const index = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
const roster = JSON.parse(readFileSync(ROSTER_FILE, "utf8"));
const excluded = new Set(roster.excludedCommunities || []);
const communities = index.rows.map(row => row.subreddit).filter(community => !excluded.has(community));
const defaultCommunity = communities.includes("LocalLLaMA") ? "LocalLLaMA" : communities[0];
const temporaryDataDir = mkdtempSync(join(tmpdir(), "reddit-insights-pages-"));
let server;

function staticHtml(html) {
  const dynamicNavigation = "location.href='?'+new URLSearchParams({subreddit:community,period})";
  const staticNavigation = "location.href='/r/'+encodeURIComponent(community)+'/'";
  if (!html.includes(dynamicNavigation)) throw new Error("Could not locate community navigation in rendered HTML.");
  return html.replace(dynamicNavigation, staticNavigation);
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/?subreddit=${encodeURIComponent(defaultCommunity)}&period=all`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the static export renderer.");
}

try {
  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(DIST_DIR, { recursive: true });
  server = spawn(process.execPath, ["scripts/reddit-memory-ui.mjs", defaultCommunity], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), REDDIT_DATA_DIR: temporaryDataDir, REDDIT_DISPLAY_DIR: DISPLAY_DIR },
    stdio: ["ignore", "ignore", "inherit"],
  });
  await waitForServer();

  let defaultHtml = "";
  for (const community of communities) {
    const response = await fetch(`http://127.0.0.1:${PORT}/?subreddit=${encodeURIComponent(community)}&period=all`);
    if (!response.ok) throw new Error(`Failed to render r/${community}: HTTP ${response.status}`);
    const html = staticHtml(await response.text());
    const output = join(DIST_DIR, "r", community, "index.html");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, html);
    if (community === defaultCommunity) defaultHtml = html;
  }

  writeFileSync(join(DIST_DIR, "index.html"), defaultHtml);
  writeFileSync(join(DIST_DIR, "404.html"), defaultHtml);
  writeFileSync(join(DIST_DIR, "_headers"), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: DENY
`);
  console.log(`Built ${communities.length} static community routes in dist/.`);
} finally {
  if (server && !server.killed) server.kill("SIGTERM");
  rmSync(temporaryDataDir, { recursive: true, force: true });
}
