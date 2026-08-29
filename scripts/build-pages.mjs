#!/usr/bin/env node

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DISPLAY_DIR = join(ROOT, "data", "reddit-display");
const DIST_DIR = join(ROOT, "dist");
const INDEX_FILE = join(DISPLAY_DIR, "index.json");
const ROSTER_FILE = join(ROOT, "config", "community-roster.json");
const PORT = 17424;
const ORIGIN = process.env.PUBLIC_ORIGIN || "https://reddit-insights.highsignal.app";
const SOCIAL_IMAGE = `${ORIGIN}/social-card.png`;
const footerScripts = `<script src="https://sassmaker.com/project-strip.js" data-project="reddit-insights" crossorigin="anonymous" defer></script><script src="https://sassmaker.com/ai-chat-footer.js" data-name="Reddit Insights" data-compose="false" crossorigin="anonymous" defer></script>`;

if (!existsSync(INDEX_FILE)) {
  throw new Error("Missing compact display index. Run npm run build:display first.");
}
const index = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
const roster = JSON.parse(readFileSync(ROSTER_FILE, "utf8"));
const excluded = new Set(roster.excludedCommunities || []);
const communities = index.rows.map(row => row.subreddit).filter(community => !excluded.has(community));
const defaultCommunity = ["LocalLLaMA", "AI_Agents", "IndiaTech", "developersIndia"].find(community => communities.includes(community)) || communities[0];
const temporaryDataDir = mkdtempSync(join(tmpdir(), "reddit-insights-pages-"));
let server;

function staticHtml(html, community) {
  const dynamicNavigation = "location.href='?'+new URLSearchParams({subreddit:community,period})";
  const staticNavigation = "location.href='/r/'+encodeURIComponent(community)+'/'";
  if (!html.includes(dynamicNavigation)) throw new Error("Could not locate community navigation in rendered HTML.");
  const canonicalUrl = `${ORIGIN}/r/${encodeURIComponent(community)}/`;
  const description = `Compare the ranked canon and inferred recent candidate pool for r/${community}, with source links and sampling limits disclosed.`;
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Reddit Insights — r/${community}`,
    url: canonicalUrl,
    description,
    isPartOf: {
      "@type": "WebSite",
      name: "Reddit Insights",
      url: ORIGIN,
    },
  }).replaceAll("<", "\\u003c");
  const metadata = `<meta name="description" content="${description}"><link rel="canonical" href="${canonicalUrl}"><meta property="og:type" content="website"><meta property="og:site_name" content="Reddit Insights"><meta property="og:title" content="Reddit Insights — r/${community}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonicalUrl}"><meta property="og:image" content="${SOCIAL_IMAGE}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="Reddit Insights — r/${community}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${SOCIAL_IMAGE}"><script type="application/ld+json">${structuredData}</script><script>fetch("https://us.i.posthog.com/i/v0/e/",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:"phc_qgiAarw4Co4pw9fz3Fxj4UJaHmqzFetqs4JrXhGc35Nd",event:"page_view",distinct_id:crypto.randomUUID(),properties:{project_id:"reddit-insights"}}),keepalive:true}).catch(()=>{});</script><script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/y6bwkyh4qb";y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","y6bwkyh4qb");window.clarity("set","project_id","reddit-insights");</script>`;
  return html
    .replace(dynamicNavigation, staticNavigation)
    .replace("</head>", `${metadata}</head>`)
    .replace("</body>", `${footerScripts}</body>`);
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
    writeFileSync(
      join(DIST_DIR, "r", community, "index.md"),
      `# Reddit Insights — r/${community}\n\nThis page compares the ranked historical canon and the inferred recent candidate pool in the collected r/${community} evidence. It shows what became prominent, what persisted, and what is currently breaking through.\n\nThe archive is not a census of all subreddit activity. Ranked records cannot estimate total historical publishing or whole-conversation prevalence, and the recent boundary is inferred when original retrieval provenance was not retained. Open the HTML research view for source-linked posts, exact coverage, and methodology.\n\n- [Open the research view](${ORIGIN}/r/${encodeURIComponent(community)}/)\n- [Read the full collection contract](${ORIGIN}/llms-full.txt)\n`,
    );
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
  writeFileSync(join(DIST_DIR, "llms-full.txt"), `# Reddit Insights\n\nReddit Insights is a static, evidence-bounded top-content observatory. It compares an available ranked historical canon with an inferred recent candidate pool, preserves source links, and discloses the sampling limits on every community view. Coverage does not imply platform-wide completeness, whole-conversation prevalence, or causal evidence.\n\n## Community views\n\n${communities.map(community => `- [r/${community}](${ORIGIN}/r/${encodeURIComponent(community)}/index.md)`).join("\n")}\n`);
  writeFileSync(join(DIST_DIR, "index.md"), `# Reddit Insights\n\nReddit Insights studies what became prominent, what persisted, and what is currently breaking through in collected subreddit evidence. It compares a ranked historical canon with an inferred recent candidate pool and keeps every finding traceable to source posts.\n\nThe archive is not a census of Reddit activity. Historical claims are bounded by the retained ranked sample, and recent observations remain one-source evidence until High Signal corroborates them across providers.\n\n- [Open the default research view](${ORIGIN}/r/${encodeURIComponent(defaultCommunity)}/)\n- [Browse the machine-readable community index](${ORIGIN}/llms-full.txt)\n`);
  mkdirSync(join(DIST_DIR, "api"), { recursive: true });
  const agentCatalog = `${JSON.stringify({
    name: "Reddit Insights",
    url: ORIGIN,
    description: "Evidence-bounded research views over ranked subreddit canon and inferred recent candidates.",
    llms: `${ORIGIN}/llms.txt`,
    llmsFull: `${ORIGIN}/llms-full.txt`,
    sitemap: `${ORIGIN}/sitemap.xml`,
    markdown: `${ORIGIN}/index.md`,
    surfaces: [{
      id: "community-research",
      url: `${ORIGIN}/r/{community}/`,
      md: `${ORIGIN}/r/{community}/index.md`,
      description: "One source-linked, sampling-bounded subreddit research view.",
    }],
  }, null, 2)}\n`;
  writeFileSync(join(DIST_DIR, "api", "ai"), agentCatalog);
  writeFileSync(join(DIST_DIR, "api", "ai.json"), agentCatalog);
  copyFileSync(join(ROOT, "assets", "social-card.png"), join(DIST_DIR, "social-card.png"));
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
