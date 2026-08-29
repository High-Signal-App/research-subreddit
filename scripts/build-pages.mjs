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
// The studio renderer opens its main column with this section; the search
// panel is injected directly above it so it is the first thing in <main>.
const SEARCH_ANCHOR = `<main><section class="studio-opening canon-opening" id="canon">`;
const SEARCH_ANCHOR_TAIL = SEARCH_ANCHOR.replace("<main>", "");
const searchStyles = `<style>
  #post-search{border:1px solid var(--rule);background:var(--panel);border-radius:var(--radius-panel);padding:20px;margin:0 0 22px}
  #post-search h2{font-size:var(--heading-xs);margin:0 0 4px}
  #post-search .visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  #post-search .post-search-deck{color:var(--quiet);font-size:var(--text-sm);margin:0 0 14px;max-width:70ch}
  #post-search-form{display:flex;gap:8px;flex-wrap:wrap}
  #post-search-input{flex:1 1 18rem;min-width:0;background:var(--studio-deep);border:1px solid var(--rule-strong);border-radius:var(--radius-control);color:var(--ink);padding:10px 12px;font:inherit;font-size:var(--text-control)}
  #post-search-input::placeholder{color:var(--quiet)}
  #post-search-input:focus-visible,#post-search button:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
  #post-search button{background:var(--cobalt);color:var(--ink);border:0;border-radius:var(--radius-control);padding:10px 20px;font:inherit;font-size:var(--text-control);font-weight:600;cursor:pointer}
  #post-search-status{color:var(--quiet);font-size:var(--text-analytical);margin:12px 0 0}
  #post-search-results{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:10px;max-height:32rem;overflow-y:auto}
  .post-search-hit{border-top:1px solid var(--rule);padding-top:10px}
  .post-search-hit a{color:var(--cyan);text-decoration:none;font-weight:600;font-size:var(--text-body)}
  .post-search-hit a:hover{text-decoration:underline}
  .post-search-hit p{color:var(--quiet);font-size:var(--text-analytical);margin:4px 0 0}
</style>`;

/** Post-level search shell. The controller module fills it in once JavaScript runs. */
function searchSection(community) {
  const label = community.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  return `<section id="post-search" data-community="${label}" aria-labelledby="post-search-heading">
  <h2 id="post-search-heading">Find a post in r/${label}</h2>
  <p class="post-search-deck">Ranked over every collected post title and body in this community. The corpus chunk is fetched once, then searched entirely in your browser — nothing you type leaves this page.</p>
  <form id="post-search-form" role="search"><label class="visually-hidden" for="post-search-input">Search collected r/${label} posts</label><input id="post-search-input" type="search" name="q" placeholder="e.g. self-hosting costs" autocomplete="off" enterkeyhint="search"><button type="submit">Search</button></form>
  <p id="post-search-status" role="status">Type a phrase to rank every collected post in this community.</p>
  <ul id="post-search-results"></ul>
</section>`;
}

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
  if (!html.includes(SEARCH_ANCHOR)) throw new Error("Could not locate the main content anchor for the post search panel.");
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
    .replace("</head>", `${metadata}${searchStyles}</head>`)
    .replace(SEARCH_ANCHOR, `<main>${searchSection(community)}${SEARCH_ANCHOR_TAIL}`)
    .replace("</body>", `<script type="module" src="/assets/browser/search-client.mjs"></script>${footerScripts}</body>`);
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

  // Ship the search runtime as plain ES modules and mirror the source layout so
  // the relative import inside search-client.mjs resolves unchanged.
  for (const [from, to] of [
    [join(ROOT, "scripts", "lib", "search-ranking.mjs"), join(DIST_DIR, "assets", "lib", "search-ranking.mjs")],
    [join(ROOT, "scripts", "browser", "search-client.mjs"), join(DIST_DIR, "assets", "browser", "search-client.mjs")],
  ]) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }

  // Publish the per-community corpus chunks the browser search fetches. They
  // are already gzipped on disk, so they are copied byte-for-byte and declared
  // as gzip-encoded in _headers rather than re-compressed here.
  const dataDir = join(DIST_DIR, "data");
  mkdirSync(dataDir, { recursive: true });
  const publishedRows = index.rows.filter(row => !excluded.has(row.subreddit));
  for (const row of publishedRows) {
    const chunk = join(DISPLAY_DIR, `${row.subreddit}.json.gz`);
    if (!existsSync(chunk)) throw new Error(`Missing display chunk for published community r/${row.subreddit}.`);
    copyFileSync(chunk, join(dataDir, `${row.subreddit}.json.gz`));
  }
  writeFileSync(
    join(dataDir, "index.json"),
    `${JSON.stringify({
      schema: index.schema,
      communities: publishedRows.length,
      records: publishedRows.reduce((sum, row) => sum + row.records, 0),
      rows: publishedRows.map(row => ({ subreddit: row.subreddit, records: row.records, grade: row.grade, bytes: row.bytes, chunk: `/data/${encodeURIComponent(row.subreddit)}.json.gz` })),
    }, null, 2)}\n`,
  );

  writeFileSync(join(DIST_DIR, "_headers"), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: DENY

/assets/*
  Content-Type: text/javascript; charset=utf-8
  Cache-Control: public, max-age=86400, immutable

/data/*
  Cache-Control: public, max-age=86400, immutable

/data/*.json.gz
  Content-Type: application/json; charset=utf-8
  Content-Encoding: gzip
`);
  console.log(`Built ${communities.length} static community routes and ${publishedRows.length} searchable corpus chunks in dist/.`);
} finally {
  if (server && !server.killed) server.kill("SIGTERM");
  rmSync(temporaryDataDir, { recursive: true, force: true });
}
