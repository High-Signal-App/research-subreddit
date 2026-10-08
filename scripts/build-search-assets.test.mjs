// Asserts the browser-search payload that scripts/build-pages.mjs emits. dist/
// is a build artifact, so these checks skip when it is absent and run for real
// in the static-export CI job, which builds first.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const DIST = process.env.PAGES_OUTPUT_DIR || join(ROOT, "dist");
const DIST_DATA = join(DIST, "data");
const skip = existsSync(DIST_DATA) ? false : "dist/data is absent — run pnpm run build:pages first";

const index = JSON.parse(readFileSync(join(ROOT, "data", "reddit-display", "index.json"), "utf8"));
const roster = JSON.parse(readFileSync(join(ROOT, "config", "community-roster.json"), "utf8"));
const excluded = new Set(roster.excludedCommunities || []);
const published = index.rows.map(row => row.subreddit).filter(name => !excluded.has(name));

test("snapshot entry point ships its controller without copying private archive data", { skip }, () => {
  const home = readFileSync(join(DIST, "index.html"), "utf8");
  assert.match(home, /Reddit, one day at a time/);
  assert.match(home, /src="\/snapshots\/home.mjs"/);
  assert.match(home, /id="lookup"[^>]*data-app-health-event="snapshot_lookup_submitted"/);
  assert.match(home, /src="\/app-health-log\.js"/);
  assert.match(home, /https:\/\/health\.sassmaker\.com\/tracker\.js[^>]*data-project="app-import-2ebd840a2a927417ca16d9c9bd3fd3576a250cc317bc0b6f8a0ce9ec3d586110"/);
  const trackerKey = home.match(/https:\/\/health\.sassmaker\.com\/tracker\.js[^>]*data-key="(ahk_pub_[A-Za-z0-9_-]+)"/)?.[1];
  const loggerSource = readFileSync(join(DIST, "app-health-log.js"), "utf8");
  const loggerKey = loggerSource.match(/var KEY = '(ahk_pub_[A-Za-z0-9_-]+)'/)?.[1];
  assert.ok(trackerKey && loggerKey, "homepage tracker and browser logger must both carry a public key");
  assert.equal(loggerKey, trackerKey, "browser logs must use the existing tracker key scoped to this product origin");
  assert.match(home, /<footer class="reddit-insights-footer" aria-label="Reddit Insights footer"><fleet-footer-extension[^>]*data-fleet-footer-project="reddit-insights"[^>]*theme="light"[^>]*font-base="\/fonts\/fleet-footer-precise-v1\/"/);
  assert.match(home, /<saas-maker-newsletter-capture slot="capture" layout="compact" integrated catalog-id="reddit-insights"[^>]*theme="light"/);
  for (const sharedScript of ["newsletter-capture.js", "project-strip.js", "ai-chat-footer.js"]) {
    assert.equal(home.split(`https://sassmaker.com/${sharedScript}`).length - 1, 1, `${sharedScript} must load once on the homepage`);
  }
  assert.match(home, /newsletter-capture\.js\?v=precise-b0adaa67/);
  assert.match(home, /project-strip\.js\?v=precise-b0adaa67[^>]*data-project="reddit-insights"[^>]*data-host-only="true"[^>]*data-theme="light"/);
  assert.match(home, /ai-chat-footer\.js\?v=precise-b0adaa67[^>]*data-project="reddit-insights"[^>]*data-host-only="true"[^>]*data-theme="light"[^>]*data-surface="web"[^>]*data-capture="false"/);
  assert.equal((home.match(/<fleet-footer-extension\b/g) || []).length, 1, "Snapshot Studio must have exactly one shared footer host");
  assert.match(home, /<a slot="cta" data-fleet-footer-cta href="#lookup">/);
  assert.match(home, /Source posts remain on Reddit\. Retained comments are filtered\./);
  assert.doesNotMatch(home, /What is an AI agent|350.*retained comments|99 communities/);
  const reader = readFileSync(join(DIST, "snapshots", "index.html"), "utf8");
  assert.match(reader, /src="\/snapshots\/app\.mjs"/);
  assert.match(reader, /src="\/app-health-log\.js"/);
  assert.match(reader, /https:\/\/health\.sassmaker\.com\/tracker\.js[^>]*data-identity="session"/);
  const readerTrackerKey = reader.match(/https:\/\/health\.sassmaker\.com\/tracker\.js[^>]*data-key="(ahk_pub_[A-Za-z0-9_-]+)"/)?.[1];
  assert.equal(readerTrackerKey, trackerKey, "daily reader must reuse the homepage's origin-scoped browser key");
  assert.match(reader, /<button id="share" data-app-health-event="snapshot_link_copy_clicked">/);
  assert.doesNotMatch(reader, /fleet-footer-extension|newsletter-capture\.js|project-strip\.js|ai-chat-footer\.js/, "the daily reader remains outside this footer migration");
  for (const id of ["json-download", "posts-download", "comments-download"]) {
    assert.match(reader, new RegExp(`<a id="${id}" data-app-health-event="snapshot_download_clicked">`));
  }
  for (const file of ["index.html", "style.css", "theme.css", "home.css", "app.mjs", "paths.mjs", "insights.mjs", "home.mjs", "home-model.mjs", "fonts/archivo.woff2", "fonts/Archivo-OFL.txt"]) assert.ok(existsSync(join(DIST, "snapshots", file)));
  assert.deepEqual(readdirSync(join(DIST, "snapshots")).sort(), ["app.mjs", "fonts", "home-model.mjs", "home.css", "home.mjs", "index.html", "insights.mjs", "paths.mjs", "style.css", "theme.css"]);
  assert.match(readFileSync(join(DIST, "_redirects"), "utf8"), /\/r\/:community\/:date\/ \/snapshots\/ 200/);
  assert.ok(!existsSync(join(DIST, "reddit-insights", "exports")));
});

test("every published community ships a gzipped corpus chunk", { skip }, () => {
  const missing = published.filter(name => !existsSync(join(DIST_DATA, `${name}.json.gz`)));
  assert.deepEqual(missing, [], `communities without a dist chunk: ${missing.join(", ")}`);
  const shipped = readdirSync(DIST_DATA).filter(file => file.endsWith(".json.gz")).map(file => file.replace(/\.json\.gz$/, ""));
  assert.deepEqual(shipped.slice().sort(), published.slice().sort(), "dist/data drifted from the published index");
  // Unpublished artifacts must never leak into the deployed bundle.
  for (const entry of index.unpublished || []) assert.ok(!shipped.includes(entry.subreddit), `unpublished r/${entry.subreddit} was exported`);
});

test("chunks stay byte-identical to the tracked corpus and decode as posts", { skip }, () => {
  const sample = published.slice(0, 3);
  for (const name of sample) {
    const source = readFileSync(join(ROOT, "data", "reddit-display", `${name}.json.gz`));
    assert.ok(source.equals(readFileSync(join(DIST_DATA, `${name}.json.gz`))), `r/${name} chunk was rewritten during the copy`);
  }
});

test("dist/data/index.json lists only published communities", { skip }, () => {
  const emitted = JSON.parse(readFileSync(join(DIST_DATA, "index.json"), "utf8"));
  assert.equal(emitted.schema, index.schema);
  assert.equal(emitted.communities, published.length);
  assert.deepEqual(emitted.rows.map(row => row.subreddit), published);
  for (const row of emitted.rows) assert.equal(row.chunk, `/data/${encodeURIComponent(row.subreddit)}.json.gz`);
});

test("_headers declares the gzip encoding and caching for /data/*", { skip }, () => {
  const headers = readFileSync(join(DIST, "_headers"), "utf8");
  assert.match(headers, /^\/data\/\*$/m, "_headers has no /data/* block");
  assert.match(headers, /^\/data\/\*\.json\.gz$/m, "_headers has no /data/*.json.gz block");
  const gzipBlock = headers.split(/^\/data\/\*\.json\.gz$/m)[1] || "";
  assert.match(gzipBlock, /Content-Encoding: gzip/, "/data/*.json.gz is not declared gzip-encoded");
  const dataBlock = headers.split(/^\/data\/\*$/m)[1] || "";
  assert.match(dataBlock, /Cache-Control: public, max-age=86400, immutable/, "/data/* is not cached");
  // index.json is served uncompressed, so the encoding must not apply to it.
  assert.doesNotMatch(dataBlock.split(/^\/data\/\*\.json\.gz$/m)[0], /Content-Encoding/, "/data/* must not claim gzip for index.json");
});

test("the search runtime is published and wired into every community page", { skip }, () => {
  assert.ok(existsSync(join(DIST, "assets", "lib", "search-ranking.mjs")));
  const client = readFileSync(join(DIST, "assets", "browser", "search-client.mjs"), "utf8");
  assert.match(client, /from "\.\.\/lib\/search-ranking\.mjs"/, "the shipped client import must resolve inside dist/assets");
  assert.match(client, /link\.dataset\.appHealthEvent = "source_thread_opened"/, "search-result sources must emit the same source CTA event");
  for (const name of published.slice(0, 3)) {
    const page = readFileSync(join(DIST, "r", name, "index.html"), "utf8");
    assert.match(page, /<section id="post-search" data-community="/, `r/${name} is missing the search panel`);
    assert.match(page, /data-app-health-event="post_search_submitted"/, `r/${name} is missing the privacy-safe post-search event`);
    assert.match(page, /data-app-health-event="source_thread_opened"/, `r/${name} is missing source-thread event wiring`);
    assert.match(page, /research_view_changed/, `r/${name} is missing community/research-window event wiring`);
    assert.match(page, /<footer class="reddit-insights-footer" aria-label="Reddit Insights footer"><fleet-footer-extension[^>]*data-fleet-footer-project="reddit-insights"[^>]*theme="dark"/, `r/${name} is missing its shared footer host`);
    assert.match(page, /saas-maker-newsletter-capture slot="capture" layout="compact" integrated catalog-id="reddit-insights"[^>]*theme="dark"/, `r/${name} is missing the consented footer capture`);
    assert.match(page, /Ranked Reddit evidence only\. HiSignal must corroborate candidates across sources before publication\./, `r/${name} lost its corroboration disclosure`);
    assert.match(page, /Search this community’s posts/);
    assert.match(page, /href="https:\/\/github\.com\/High-Signal-App\/research-subreddit"[^>]*aria-label="Reddit Insights · r\//);
    assert.match(page, /project-strip\.js\?v=precise-b0adaa67[^>]*data-project="reddit-insights"[^>]*data-host-only="true"[^>]*data-theme="dark"/);
    assert.match(page, /ai-chat-footer\.js\?v=precise-b0adaa67[^>]*data-project="reddit-insights"[^>]*data-host-only="true"[^>]*data-theme="dark"[^>]*data-surface="web"[^>]*data-capture="false"/);
    assert.equal((page.match(/<fleet-footer-extension\b/g) || []).length, 1, `r/${name} must have exactly one shared footer host`);
    assert.match(page, /https:\/\/health\.sassmaker\.com\/tracker\.js[^>]*data-project="app-import-2ebd840a2a927417ca16d9c9bd3fd3576a250cc317bc0b6f8a0ce9ec3d586110"/, `r/${name} is missing the App Health visit tracker`);
    assert.match(page, /<script type="module" src="\/assets\/browser\/search-client\.mjs"><\/script>/, `r/${name} is missing the search controller`);
  }
  const logger = readFileSync(join(DIST, "app-health-log.js"), "utf8");
  assert.match(logger, /actionName === 'source_thread_opened'.*track\(actionName\)/);
  assert.match(logger, /track\(eventName\)/);
  assert.match(readFileSync(join(DIST, "privacy", "index.html"), "utf8"), /session-only identifier/);
  assert.match(readFileSync(join(DIST, "privacy", "index.html"), "utf8"), /snapshot lookup submissions/);
});

test("the footer publishes only its allowlisted art and local Geist font assets", { skip }, () => {
  const art = readFileSync(join(DIST, "footer-art", "reddit-insights.webp"));
  const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256(art), "bf2ac20dedbae952868f879468c851773f0dc40291a43376990f3608fe1f950b");
  const artProvenance = JSON.parse(readFileSync(join(DIST, "footer-art", "reddit-insights.provenance.json"), "utf8"));
  assert.equal(artProvenance.publicIntended, true);
  assert.equal(artProvenance.originalSha256, "abfe1e2b062823b060dba5adb175137a1baca6ff7a7301ebcc612d5d06e604e7");
  assert.equal(artProvenance.derivativeSha256, sha256(art));
  const fontDir = join(DIST, "fonts", "fleet-footer-precise-v1");
  assert.equal(sha256(readFileSync(join(fontDir, "geist.woff2"))), "19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1");
  assert.equal(sha256(readFileSync(join(fontDir, "geistmono.woff2"))), "3f98383b122fe015a48536cd4a1cda855a201718923ffe74931a01597107b9b5");
  for (const file of ["geist-OFL.txt", "geistmono-OFL.txt"]) assert.equal(sha256(readFileSync(join(fontDir, file))), "fb64c1011862d97fe49c633ad9180ffd80a61aab6ff220a2935704e8a0c3a7c4");
  const fontProvenance = JSON.parse(readFileSync(join(fontDir, "provenance.json"), "utf8"));
  assert.equal(fontProvenance.runtimePolicy, "Same-origin font-base is authored in the footer host. Actual browser font loading remains unverified.");
  assert.equal(fontProvenance.fonts[0].upstreamLicenseSha256, "1781d2806a07d91c4edf4740b88449fab7d0eadad53f7c351b94cd4d4eb8c00f");
});


test("missing communities show an unavailable page without substituted analysis", { skip }, () => {
  const page = readFileSync(join(DIST, "404.html"), "utf8");
  assert.match(page, /This community page is unavailable/);
  assert.match(page, /name="robots" content="noindex"/);
  assert.doesNotMatch(page, /id="post-search"|id="canon"|Candidate index/);
  for (const name of published) assert.ok(page.includes(`/r/${encodeURIComponent(name)}/`));
  for (const name of excluded) assert.ok(!page.includes(`/r/${encodeURIComponent(name)}/`));
});
