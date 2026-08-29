// Lexical post ranking shared by the Node test suite and the browser search
// client. It must stay dependency-free and free of Node built-ins: the exact
// same file is copied into dist/ and loaded as an ES module by the page.

/**
 * @typedef {{ id: string, permalink: string, title: string, selftext: string }} DisplayPost
 * @typedef {{ post: DisplayPost, score: number }} RankedPost
 * @typedef {{ terms: Map<string, number>, length: number }} DocumentIndex
 * @typedef {{ posts: DisplayPost[], documents: DocumentIndex[], documentFrequency: Map<string, number>, averageLength: number }} SearchIndex
 */

const K1 = 1.2;
const B = 0.75;
// Titles carry the topic; bodies carry the detail. Counting the title twice
// keeps a headline match ahead of a passing mention buried in a long body.
const TITLE_WEIGHT = 2;

/**
 * Case-folded word tokens. Splitting on anything that is not a letter or digit
 * keeps Unicode words intact while dropping Reddit's markdown punctuation.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize("NFKD")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && token.length < 40);
}

/**
 * Build the BM25 statistics once per loaded community chunk.
 * @param {DisplayPost[]} posts
 * @returns {SearchIndex}
 */
export function buildSearchIndex(posts) {
  /** @type {DocumentIndex[]} */
  const documents = [];
  /** @type {Map<string, number>} */
  const documentFrequency = new Map();
  let totalLength = 0;

  for (const post of posts) {
    /** @type {string[]} */
    const tokens = [];
    for (let repeat = 0; repeat < TITLE_WEIGHT; repeat++)
      tokens.push(...tokenize(post.title || ""));
    tokens.push(...tokenize(post.selftext || ""));
    /** @type {Map<string, number>} */
    const terms = new Map();
    for (const token of tokens) terms.set(token, (terms.get(token) || 0) + 1);
    for (const term of terms.keys())
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    documents.push({ terms, length: tokens.length });
    totalLength += tokens.length;
  }

  return {
    posts,
    documents,
    documentFrequency,
    averageLength: documents.length ? totalLength / documents.length : 0,
  };
}

/**
 * Rank posts against a free-text query with Okapi BM25. Returns an empty list
 * for an empty query or a query whose terms are absent from the corpus, so the
 * caller can tell "nothing typed" from "nothing found" by inspecting the query.
 * @param {SearchIndex} index
 * @param {string} query
 * @param {number} [limit]
 * @returns {RankedPost[]}
 */
export function rankPosts(index, query, limit = 25) {
  const queryTerms = [...new Set(tokenize(query))];
  if (!queryTerms.length || !index.documents.length) return [];

  const total = index.documents.length;
  /** @type {RankedPost[]} */
  const ranked = [];

  for (let position = 0; position < total; position++) {
    const document = index.documents[position];
    let score = 0;
    for (const term of queryTerms) {
      const frequency = document.terms.get(term);
      if (!frequency) continue;
      const containing = index.documentFrequency.get(term) || 0;
      // Robertson/Sparck-Jones IDF, floored so a term present in nearly every
      // document contributes nothing instead of a negative score.
      const idf = Math.max(
        0,
        Math.log(1 + (total - containing + 0.5) / (containing + 0.5)),
      );
      const normalized = index.averageLength
        ? document.length / index.averageLength
        : 1;
      score +=
        idf *
        ((frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * normalized)));
    }
    if (score > 0) ranked.push({ post: index.posts[position], score });
  }

  ranked.sort(
    (left, right) =>
      right.score - left.score || left.post.id.localeCompare(right.post.id),
  );
  return ranked.slice(0, Math.max(0, limit));
}

/**
 * A short body extract centred on the first matching query term, for result
 * previews. Falls back to the opening of the body when nothing matches.
 * @param {string} text
 * @param {string} query
 * @param {number} [width]
 * @returns {string}
 */
export function excerpt(text, query, width = 220) {
  const body = (text || "").replace(/\s+/g, " ").trim();
  if (body.length <= width) return body;
  const terms = tokenize(query);
  const haystack = body.toLowerCase();
  let hit = -1;
  for (const term of terms) {
    const found = haystack.indexOf(term);
    if (found !== -1 && (hit === -1 || found < hit)) hit = found;
  }
  if (hit === -1) return `${body.slice(0, width).trimEnd()}…`;
  const start = Math.max(0, hit - Math.floor(width / 3));
  const slice = body.slice(start, start + width).trim();
  return `${start > 0 ? "…" : ""}${slice}…`;
}
