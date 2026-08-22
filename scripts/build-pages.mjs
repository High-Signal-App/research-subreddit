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
const ORIGIN = "https://reddit-insights.highsignal.app";

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

function staticHtml(html, community) {
  const dynamicNavigation = "location.href='?'+new URLSearchParams({subreddit:community,period})";
  const staticNavigation = "location.href='/r/'+encodeURIComponent(community)+'/'";
  if (!html.includes(dynamicNavigation)) throw new Error("Could not locate community navigation in rendered HTML.");
  const canonicalUrl = `${ORIGIN}/r/${encodeURIComponent(community)}/`;
  const description = `Inspect the collected Reddit evidence, topic history, and attention patterns for r/${community}.`;
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `Reddit Insights — r/${community}`,
    url: canonicalUrl,
    description,
    isPartOf: {
      "@type": "WebSite",
      name: "Reddit Insights",
      url: ORIGIN,
    },
  }).replaceAll("<", "\\u003c");
  const metadata = `<meta name="description" content="${description}"><link rel="canonical" href="${canonicalUrl}"><meta property="og:type" content="website"><meta property="og:site_name" content="Reddit Insights"><meta property="og:title" content="Reddit Insights — r/${community}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonicalUrl}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="Reddit Insights — r/${community}"><meta name="twitter:description" content="${description}"><script type="application/ld+json">${structuredData}</script><script>!function(t,e){var o,n,a,r;function s(e){(o=t._phq=t._phq||[]).push([].slice.call(e))}o=t.posthog=function(e,n){s([e,n])},o.__loaded||(a=e.createElement("script"),a.type="text/javascript",a.async=!0,a.crossOrigin="anonymous",a.src="https://us.i.posthog.com/array.js",r=e.getElementsByTagName("script")[0],r.parentNode.insertBefore(a,r),o.__loaded=!0),t.posthog.init("phc_qgiAarw4Co4pw9fz3Fxj4UJaHmqzFetqs4JrXhGc35Nd",{api_host:"https://us.i.posthog.com",person_profiles:"always",capture_pageview:!1,autocapture:!1,loaded:function(){t.posthog.capture("page_view",{project_id:"reddit-insights"})}})}(window,document);</script><script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/y6bwkyh4qb";y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","y6bwkyh4qb");window.clarity("set","project_id","reddit-insights");</script>`;
  return html.replace(dynamicNavigation, staticNavigation).replace("</head>", `${metadata}</head>`);
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
    const html = staticHtml(await response.text(), community);
    const output = join(DIST_DIR, "r", community, "index.html");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, html);
    if (community === defaultCommunity) defaultHtml = html;
  }

  writeFileSync(join(DIST_DIR, "index.html"), defaultHtml);
  writeFileSync(join(DIST_DIR, "404.html"), defaultHtml.replace("</head>", '<meta name="robots" content="noindex"></head>'));
  writeFileSync(join(DIST_DIR, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  writeFileSync(
    join(DIST_DIR, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${communities.map(community => `<url><loc>${ORIGIN}/r/${encodeURIComponent(community)}/</loc></url>`).join("")}</urlset>\n`,
  );
  writeFileSync(join(DIST_DIR, "llms.txt"), `# Reddit Insights\n\nEvidence-bounded research views over collected Reddit community activity.\n\n- ${ORIGIN}/index.md\n- ${ORIGIN}/llms-full.txt\n- ${ORIGIN}/api/ai\n`);
  writeFileSync(join(DIST_DIR, "llms-full.txt"), `# Reddit Insights\n\nReddit Insights publishes static, evidence-bounded research views for the communities in its disclosed collection roster. Each /r/{subreddit}/ page summarizes collected topic history and source-linked attention patterns. Coverage does not imply platform-wide completeness, and observations are not causal claims.\n`);
  writeFileSync(join(DIST_DIR, "index.md"), `# Reddit Insights\n\nReddit Insights is a static research observatory for collected subreddit evidence, topic history, and attention patterns. Collection coverage is disclosed and does not imply platform-wide completeness or causal evidence.\n`);
  mkdirSync(join(DIST_DIR, "api"), { recursive: true });
  writeFileSync(
    join(DIST_DIR, "api", "ai.json"),
    `${JSON.stringify({ name: "Reddit Insights", url: ORIGIN, description: "Evidence-bounded research views over collected Reddit community activity.", collections: [{ pathTemplate: "/r/{subreddit}/", description: "One static community research view" }] }, null, 2)}\n`,
  );
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
