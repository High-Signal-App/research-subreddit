// Browser-only search controller for the static community pages. Copied
// verbatim into dist/assets/browser/ by scripts/build-pages.mjs, alongside
// dist/assets/lib/search-ranking.mjs, so this relative import resolves both
// here and on the deployed site.
import { buildSearchIndex, excerpt, rankPosts } from "../lib/search-ranking.mjs";

const RESULT_LIMIT = 25;
// Reddit stores titles and bodies HTML-escaped. Results are written with
// textContent, so the entities have to be resolved here or they show verbatim.
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decode = text => (text || "").replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, match => ENTITIES[match]);

const root = document.getElementById("post-search");
const form = document.getElementById("post-search-form");
const input = document.getElementById("post-search-input");
const status = document.getElementById("post-search-status");
const results = document.getElementById("post-search-results");

if (root && form && input && status && results) {
  const community = root.dataset.community || "";
  let index = null;
  let loading = null;

  const say = message => {
    status.textContent = message;
  };

  // The chunks ship pre-gzipped. Cloudflare Pages declares Content-Encoding via
  // _headers so the browser inflates them transparently, but any plain static
  // host will hand back the raw bytes -- inflate those ourselves rather than
  // failing, which also keeps `npx serve dist` usable for local checks.
  async function readChunk(response) {
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder().decode(buffer);
    try {
      return JSON.parse(text);
    } catch {
      const stream = new Response(buffer).body.pipeThrough(new DecompressionStream("gzip"));
      return await new Response(stream).json();
    }
  }

  async function load() {
    if (index) return index;
    if (!loading) {
      loading = (async () => {
        const response = await fetch(`/data/${encodeURIComponent(community)}.json.gz`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const chunk = await readChunk(response);
        const posts = Array.isArray(chunk.posts) ? chunk.posts : [];
        index = buildSearchIndex(posts);
        return index;
      })().catch(error => {
        loading = null;
        throw error;
      });
    }
    return loading;
  }

  function render(ranked, query) {
    results.replaceChildren();
    for (const entry of ranked) {
      const item = document.createElement("li");
      item.className = "post-search-hit";
      const link = document.createElement("a");
      link.href = `https://reddit.com${entry.post.permalink}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = decode(entry.post.title) || "(untitled post)";
      const preview = document.createElement("p");
      preview.textContent = decode(excerpt(entry.post.selftext, query));
      item.append(link);
      if (preview.textContent) item.append(preview);
      results.append(item);
    }
  }

  async function search(query) {
    if (!query.trim()) {
      results.replaceChildren();
      say("Type a phrase to rank every collected post in this community.");
      return;
    }
    say(index ? "Searching…" : `Loading the r/${community} post corpus…`);
    let ready;
    try {
      ready = await load();
    } catch (error) {
      results.replaceChildren();
      say(`Could not load the r/${community} post corpus (${error.message}). Reload the page to retry.`);
      return;
    }
    const ranked = rankPosts(ready, query, RESULT_LIMIT);
    render(ranked, query);
    if (!ranked.length) say(`No post in the collected r/${community} corpus matches “${query}”. Try fewer or broader words.`);
    else say(`${ranked.length}${ranked.length === RESULT_LIMIT ? "+" : ""} of ${ready.posts.length.toLocaleString()} collected posts, ranked by relevance.`);
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    search(input.value);
  });
  // Warm the chunk on first intent so the first query does not pay for it.
  input.addEventListener("focus", () => load().catch(() => {}), { once: true });
}
