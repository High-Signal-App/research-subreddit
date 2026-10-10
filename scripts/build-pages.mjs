#!/usr/bin/env node

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DISPLAY_DIR = join(ROOT, "data", "reddit-display");
const DIST_DIR = process.env.PAGES_OUTPUT_DIR ? resolve(process.env.PAGES_OUTPUT_DIR) : join(ROOT, "dist");
const INDEX_FILE = join(DISPLAY_DIR, "index.json");
const ROSTER_FILE = join(ROOT, "config", "community-roster.json");
const PORT = 17424;
const ORIGIN = process.env.PUBLIC_ORIGIN || "https://reddit-insights.highsignal.app";
const SOCIAL_IMAGE = `${ORIGIN}/social-card.png`;
const footerCapture = theme => `<saas-maker-newsletter-capture slot="capture" layout="compact" integrated catalog-id="reddit-insights" product-name="Reddit Insights" kind="newsletter" source="footer" privacy-url="/privacy/" theme="${theme}"></saas-maker-newsletter-capture>`;
const footerScripts = theme => `<script src="/app-health-log.js" defer></script><script defer src="https://health.sassmaker.com/tracker.js" data-vitals data-key="ahk_pub_5fd468bae12640af79faa6aa53f76cc7e453914551888aed55e73f0a7d762417" data-project="app-import-2ebd840a2a927417ca16d9c9bd3fd3576a250cc317bc0b6f8a0ce9ec3d586110" data-identity="session" data-endpoint="https://ingest.sassmaker.com/v1/browser"></script><script type="module" src="https://sassmaker.com/newsletter-capture.js?v=precise-b0adaa67"></script><script src="https://sassmaker.com/project-strip.js?v=precise-b0adaa67" data-project="reddit-insights" data-host-only="true" data-theme="${theme}" crossorigin="anonymous" defer></script><script src="https://sassmaker.com/ai-chat-footer.js?v=precise-b0adaa67" data-name="Reddit Insights" data-project="reddit-insights" data-host-only="true" data-theme="${theme}" data-surface="web" data-capture="false" crossorigin="anonymous" defer></script>`;

const newsletterScriptMarker = '<script type="module" src="https://sassmaker.com/newsletter-capture.js?v=precise-b0adaa67">';
const newsletterScriptIndex = footerScripts('light').indexOf(newsletterScriptMarker);
if (newsletterScriptIndex < 0) throw new Error("Could not locate the shared newsletter script marker to derive App Health scripts.");
const appHealthScripts = footerScripts('light').slice(0, newsletterScriptIndex);

const footerExtension = ({ theme, nativeFont, cta, navigation, capture = true }) => `<footer class="reddit-insights-footer" aria-label="Reddit Insights footer"><fleet-footer-extension data-fleet-footer-project="reddit-insights" product-name="Reddit Insights" art-src="/footer-art/reddit-insights.webp" art-alt="Reddit Insights: A community research bulletin board centers one unlettered day folder with a source-linked discussion card inside its boundary. Separate community drawers and empty unobserved-day slots make captured scope visible." art-width="2172" art-height="724" art-position="50% 50%" art-credit="Original illustration for Reddit Insights" surface="web" theme="${theme}" font-base="/fonts/fleet-footer-precise-v1/" signature-font="inherit" style="font-family: ${nativeFont};"><a slot="cta" data-fleet-footer-cta href="${cta.href}">${cta.label}</a><nav slot="navigation" aria-label="Reddit Insights footer">${navigation}</nav>${capture ? footerCapture(theme) : ''}</fleet-footer-extension></footer>`;

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
  footer.reddit-insights-footer{display:block;width:100%;max-width:none;margin:0;padding:0;border:0;color:inherit}
  .research-footer-native{display:grid;gap:10px;min-width:0}
  .research-footer-native p{max-width:62ch;margin:0;color:var(--quiet)}
  .research-footer-native .research-footer-links{display:flex;flex-wrap:wrap;gap:8px 18px}
  .research-footer-native a{min-height:44px;display:inline-flex;align-items:center;color:var(--cyan);text-underline-offset:3px}
  @media(max-width:700px){.research-footer-native .research-footer-links{display:grid;gap:0}}
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
  <form id="post-search-form" role="search" data-app-health-event="post_search_submitted"><label class="visually-hidden" for="post-search-input">Search collected r/${label} posts</label><input id="post-search-input" type="search" name="q" placeholder="e.g. self-hosting costs" autocomplete="off" enterkeyhint="search"><button type="submit">Search</button></form>
  <p id="post-search-status" role="status">Type a phrase to rank every collected post in this community.</p>
  <ul id="post-search-results"></ul>
</section>`;
}

if (!existsSync(INDEX_FILE)) {
  throw new Error("Missing compact display index. Run pnpm run build:display first.");
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
  const withInstrumentedSources = html.replace(/<a\b(?=[^>]*\bhref=["']https?:\/\/(?:www\.)?reddit\.com\/)[^>]*>/gi, anchor =>
    /\bdata-app-health-event=/.test(anchor) ? anchor : anchor.replace(/>$/, ` data-app-health-event="source_thread_opened">`),
  );
  if (!withInstrumentedSources.includes('<footer class="studio-footer">')) throw new Error("Could not locate the research footer for the consented capture form.");
  const nativeFooter = `<div class="research-footer-native"><strong>Reddit Insights · Top-content Observatory</strong><p>Ranked Reddit evidence only. HiSignal must corroborate candidates across sources before publication.</p><div class="research-footer-links"><a href="/">Snapshot Studio</a><a href="#post-search">Search this community’s posts</a><a href="/privacy/">Privacy</a><a class="source-link" href="https://github.com/High-Signal-App/research-subreddit" target="_blank" rel="noopener noreferrer" aria-label="Reddit Insights · r/${community} — source on GitHub"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div></div>`;
  const cFooter = footerExtension({ theme: "dark", nativeFont: "Arial Black, Arial, Helvetica, sans-serif", cta: { href: "#post-search", label: "Search this community’s posts →" }, navigation: nativeFooter });
  return withInstrumentedSources
    .replace(dynamicNavigation, staticNavigation)
    .replace("</head>", `${metadata}${searchStyles}</head>`)
    .replace(SEARCH_ANCHOR, `<main>${searchSection(community)}${SEARCH_ANCHOR_TAIL}`)
    .replace(/<footer class="studio-footer">[\s\S]*?<\/footer><\/div>/, `</div>${cFooter}`)
    .replace("</body>", `<script type="module" src="/assets/browser/search-client.mjs"></script>${footerScripts("dark")}</body>`);
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
  mkdirSync(join(DIST_DIR, "footer-art"), { recursive: true });
  for (const file of ["reddit-insights.webp", "reddit-insights.provenance.json"]) {
    copyFileSync(join(ROOT, "assets", "footer-art", file), join(DIST_DIR, "footer-art", file));
  }
  const footerFontDir = join(DIST_DIR, "fonts", "fleet-footer-precise-v1");
  mkdirSync(footerFontDir, { recursive: true });
  for (const file of ["geist.woff2", "geistmono.woff2", "geist-OFL.txt", "geistmono-OFL.txt", "provenance.json"]) {
    copyFileSync(join(ROOT, "assets", "fonts", "fleet-footer-precise-v1", file), join(footerFontDir, file));
  }
  server = spawn(process.execPath, ["scripts/reddit-memory-ui.mjs", defaultCommunity], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), REDDIT_DATA_DIR: temporaryDataDir, REDDIT_DISPLAY_DIR: DISPLAY_DIR },
    stdio: ["ignore", "ignore", "inherit"],
  });
  await waitForServer();

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
  }

  // Snapshot HTML contains no data. Private exports are served only by the API.
  mkdirSync(join(DIST_DIR, "snapshots"), { recursive: true });
  mkdirSync(join(DIST_DIR, "snapshots", "fonts"), { recursive: true });
  for (const file of ["index.html", "style.css", "theme.css", "home.css", "app.mjs", "paths.mjs", "insights.mjs", "home.mjs", "home-model.mjs", "fonts/archivo.woff2", "fonts/Archivo-OFL.txt"]) {
    copyFileSync(join(ROOT, "scripts", "snapshots", "viewer", file), join(DIST_DIR, "snapshots", file));
  }
  const readerPath = join(DIST_DIR, "snapshots", "index.html");
  const readerHtml = readFileSync(readerPath, "utf8").replace("</body>", `${appHealthScripts}</body>`);
  writeFileSync(readerPath, readerHtml);
  const homeNative = `<div class="research-footer-native"><a class="brand" href="/">Reddit Insights</a><p>Captured records, with their limits intact.<br>Source posts remain on Reddit. Retained comments are filtered.</p><div class="research-footer-links"><a href="#how">How it works</a><a href="/privacy/">Privacy</a></div></div>`;
  const homeFooter = footerExtension({ theme: "light", nativeFont: "Archivo, Arial, sans-serif", cta: { href: "#lookup", label: "Find a snapshot ↗" }, navigation: homeNative });
  const homeHtml = readFileSync(join(ROOT, "scripts", "snapshots", "viewer", "home.html"), "utf8")
    .replace(/<footer>[\s\S]*?<\/footer>/, homeFooter)
    .replace("</body>", `${footerScripts("light")}</body>`);
  writeFileSync(join(DIST_DIR, "index.html"), homeHtml);
  writeFileSync(join(DIST_DIR, "_redirects"), "/r/:community/:date/:version/ /snapshots/ 200\n/r/:community/:date/ /snapshots/ 200\n");
  // Missing/unpublished communities must not masquerade as the default corpus.
  const unavailableHtml = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Community unavailable · Reddit Insights</title><style>body{margin:0;background:#10151e;color:#edf1f7;font:16px/1.6 system-ui,sans-serif}main{max-width:56rem;margin:8vh auto;padding:24px}h1{font-size:clamp(2rem,5vw,3rem);line-height:1.15}p{max-width:65ch;color:#b5bfce}a{color:#78baff}a:focus-visible{outline:2px solid currentColor;outline-offset:4px}ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:12px;list-style:none;padding:0}li a{display:block;padding:10px 12px;border:1px solid #354256;border-radius:8px;overflow-wrap:anywhere}</style></head><body><main><p>Reddit Insights</p><h1>This community page is unavailable.</h1><p>The requested page is missing or has not been published. No other community's analysis has been substituted. Choose one of the available collected communities below.</p><p><a href="/">Open the default research view</a></p><h2>Available communities</h2><ul>${communities.map(community => `<li><a href="/r/${encodeURIComponent(community)}/">r/${community.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</a></li>`).join("")}</ul></main></body></html>`;
  writeFileSync(join(DIST_DIR, "404.html"), unavailableHtml);
  writeFileSync(join(DIST_DIR, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  mkdirSync(join(DIST_DIR, "privacy"), { recursive: true });
  writeFileSync(join(DIST_DIR, "privacy", "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><title>Privacy · Reddit Insights</title><style>body{margin:0;background:#080b14;color:#f2f4fa;font:16px/1.65 system-ui,sans-serif}main{max-width:48rem;margin:0 auto;padding:clamp(1.5rem,5vw,4rem)}a{color:#72d7e7}h1,h2{line-height:1.2}p,li{color:#c1c7d5}</style><main><p><a href="/">Reddit Insights</a></p><h1>Privacy</h1><p>Reddit Insights is a public research archive. Its post search ranks the collected corpus in your browser; the words you search are not sent to this site or included in analytics.</p><h2>Anonymous usage analytics</h2><p>We collect page visits and a small set of actions (snapshot lookup submissions, community or research-window changes, post searches, and source-thread opens) to understand whether the archive is useful. Analytics use a session-only identifier and do not include search text, post titles, email addresses, or Reddit account details.</p><h2>Optional email updates</h2><p>If you choose to subscribe, the signup service receives your email address and records your explicit consent so it can send occasional Reddit Insights newsletter emails. Subscription is optional. Use the unsubscribe link included in any email to stop future messages.</p><p>Source posts remain on Reddit. This site does not ask for your Reddit login.</p></main></html>\n`);
  writeFileSync(
    join(DIST_DIR, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${communities.map(community => `<url><loc>${ORIGIN}/r/${encodeURIComponent(community)}/</loc></url>`).join("")}</urlset>\n`,
  );
  writeFileSync(join(DIST_DIR, "llms.txt"), `# Reddit Insights\n\nEvidence-bounded research views over collected Reddit community activity.\n\n- ${ORIGIN}/index.md\n- ${ORIGIN}/llms-full.txt\n- ${ORIGIN}/api/ai\n`);
  writeFileSync(join(DIST_DIR, "llms-full.txt"), `# Reddit Insights\n\nReddit Insights provides subreddit/collection-date snapshots with source links, filtered retained comments and JSON/CSV exports. Snapshot serving requires configured private derivatives and the API; unavailable dates never fall back to historical data. The historical observatory compares an available ranked historical canon with an inferred recent candidate pool, preserves source links, and discloses the sampling limits on every community view. Coverage does not imply platform-wide completeness, whole-conversation prevalence, or causal evidence.\n\n## Community views\n\n${communities.map(community => `- [r/${community}](${ORIGIN}/r/${encodeURIComponent(community)}/index.md)`).join("\n")}\n`);
  writeFileSync(join(DIST_DIR, "index.md"), `# Reddit Insights\n\nReddit Insights lets people inspect and share captured subreddit activity by collection date. Open /snapshots/ to select a community/day and download the same bounded evidence. Each collection shows its exact UTC window; retained comments are filtered. The historical research views study what became prominent, what persisted, and what is currently breaking through in collected subreddit evidence. It compares a ranked historical canon with an inferred recent candidate pool and keeps every finding traceable to source posts.\n\nThe archive is not a census of Reddit activity. Historical claims are bounded by the retained ranked sample, and recent observations remain one-source evidence until High Signal corroborates them across providers.\n\n- [Open the default research view](${ORIGIN}/r/${encodeURIComponent(defaultCommunity)}/)\n- [Browse the machine-readable community index](${ORIGIN}/llms-full.txt)\n`);
  mkdirSync(join(DIST_DIR, "api"), { recursive: true });
  const agentCatalog = `${JSON.stringify({
    name: "Reddit Insights",
    url: ORIGIN,
    description: "Subreddit/collection-date snapshots with source evidence and JSON/CSV downloads, alongside historical research views.",
    llms: `${ORIGIN}/llms.txt`,
    llmsFull: `${ORIGIN}/llms-full.txt`,
    sitemap: `${ORIGIN}/sitemap.xml`,
    markdown: `${ORIGIN}/index.md`,
    surfaces: [{
      id: "daily-snapshots",
      url: `${ORIGIN}/snapshots/`,
      catalog: `${ORIGIN}/api/snapshots/catalog`,
      description: "Captured subreddit/day posts and retained discussion; requires configured snapshot storage.",
    }, {
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
    [join(ROOT, "scripts", "browser", "app-health-log.js"), join(DIST_DIR, "app-health-log.js")],
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

/snapshots/*.mjs
  Content-Type: text/javascript; charset=utf-8

/data/*
  Cache-Control: public, max-age=86400, immutable

/data/*.json.gz
  Content-Type: application/json; charset=utf-8
  Content-Encoding: gzip
`);
  console.log(`Built snapshot shell, ${communities.length} historical routes and ${publishedRows.length} searchable corpus chunks in ${DIST_DIR}.`);
} finally {
  if (server && !server.killed) server.kill("SIGTERM");
  rmSync(temporaryDataDir, { recursive: true, force: true });
}
