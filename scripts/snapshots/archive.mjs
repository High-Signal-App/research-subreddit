import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_PACK_BYTES = 64 * 1024 * 1024;
const POST_FIELDS = ["id", "subreddit", "title", "body", "permalink", "createdUtc", "edited", "score", "upvoteRatio", "commentCount", "flair", "nsfw", "spoiler", "stickied", "locked", "archived", "removalState", "retrievedAt"];
const COMMENT_FIELDS = ["id", "postId", "parentId", "subreddit", "body", "createdUtc", "edited", "score", "controversiality", "stickied", "collapsed", "depth", "isSubmitter", "removalState", "retrievedAt"];

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const integer = value => Number.isSafeInteger(value) && value >= 0;

export function verifyFile(bytes, receipt) {
  requireThat(receipt && bytes.length === receipt.bytes && sha256(bytes) === receipt.sha256, "Archive checksum or size mismatch");
}

function decodeRows(bytes, fields) {
  requireThat(bytes.length <= MAX_PACK_BYTES, "Decoded archive exceeds limit");
  if (!bytes.length) return [];
  requireThat(bytes.at(-1) === 10, "Archive JSONL must end with a newline");
  requireThat(Array.isArray(fields) && new Set(fields).size === fields.length, "Invalid archive field schema");
  return bytes.toString("utf8").trimEnd().split("\n").map(line => {
    const values = JSON.parse(line);
    requireThat(Array.isArray(values) && values.length === fields.length, "Archive row does not match schema");
    return Object.fromEntries(fields.map((key, index) => [key, values[index]]));
  });
}

function project(row, fields) {
  const result = Object.fromEntries(fields.map(key => [key, row[key] ?? null]));
  requireThat(typeof result.body === "string" && Number.isFinite(result.score) && Number.isFinite(result.createdUtc), "Invalid content row");
  requireThat(Number.isFinite(Date.parse(result.retrievedAt)), "Invalid capture timestamp");
  // A redacted source receipt must not republish its previously captured text.
  if (result.removalState || result.body === "[deleted]" || result.body === "[removed]") {
    result.body = "[removed]";
    if ("title" in result) result.title = "[removed]";
  }
  return result;
}

function partition(bytes, rows, entry, kind, expected) {
  const range = entry[kind];
  const decoded = entry.decodedRanges[kind];
  requireThat(range && decoded && [range.startLine, range.count, decoded.startByte, decoded.bytes].every(integer), "Invalid partition range");
  requireThat(range.count === expected && range.startLine + range.count <= rows.length && decoded.startByte + decoded.bytes <= bytes.length, "Partition count or bounds mismatch");
  const selected = rows.slice(range.startLine, range.startLine + range.count);
  const actualLines = bytes.subarray(decoded.startByte, decoded.startByte + decoded.bytes);
  const fields = Object.keys(rows[0] || {});
  const byBytes = decodeRows(actualLines, fields);
  requireThat(JSON.stringify(selected) === JSON.stringify(byBytes), "Partition line and byte ranges disagree");
  return selected;
}

/** Pure projector: caller verifies compressed packs and supplies bounded decoded bytes. */
export function projectArchive({ manifest, index, postsBytes, commentsBytes, revision }) {
  requireThat(manifest.schema === "high-signal.reddit-daily-archive.v2", "Unsupported archive schema");
  const identity = /^reddit\/v2\/run=(\d+)\/attempt=(\d+)\/date=(\d{4}-\d{2}-\d{2})$/.exec(manifest.objectPrefix);
  requireThat(identity && index.archiveDate === identity[3], "Archive identity mismatch");
  const [, run, attempt, date] = identity;
  const start = Date.parse(manifest.windowStart), end = Date.parse(manifest.windowEnd);
  requireThat(Number.isFinite(start) && end - start === 86400000 && manifest.windowEnd.startsWith(date), "Invalid collection window");
  requireThat(Number.isFinite(Date.parse(manifest.generatedAt)) && /^[a-f0-9]{64}$/.test(revision), "Invalid snapshot revision");
  for (const [fields, required] of [[manifest.schemas?.posts, POST_FIELDS], [manifest.schemas?.comments, COMMENT_FIELDS]]) {
    requireThat(Array.isArray(fields) && required.every(field => fields.includes(field)), "Missing required archive fields");
  }
  const posts = decodeRows(postsBytes, manifest.schemas.posts);
  const comments = decodeRows(commentsBytes, manifest.schemas.comments);
  requireThat(posts.length === manifest.postCount && comments.length === manifest.commentCount, "Global archive counts mismatch");
  requireThat(Array.isArray(manifest.results) && manifest.results.length === Object.keys(index.communities).length, "Community receipts mismatch");
  const usedPosts = new Set(), usedComments = new Set(), communities = new Set();
  const snapshots = manifest.results.map(result => {
    const subreddit = result.subreddit;
    requireThat(/^[A-Za-z0-9_]{2,30}$/.test(subreddit) && !communities.has(subreddit.toLowerCase()), "Invalid or duplicate community");
    communities.add(subreddit.toLowerCase());
    const entry = index.communities[subreddit];
    requireThat(entry && entry.status === result.status && ["complete", "partial", "failed"].includes(result.status), "Coverage receipt mismatch");
    const postRows = partition(postsBytes, posts, entry, "posts", result.posts);
    const commentRows = partition(commentsBytes, comments, entry, "comments", result.comments);
    const postIds = new Set(postRows.map(row => row.id));
    const commentParents = new Map(commentRows.map(row => [`t1_${row.id}`, row.postId]));
    for (const row of postRows) {
      requireThat(row.subreddit?.toLowerCase() === subreddit.toLowerCase() && /^[a-z0-9]+$/.test(row.id) && !usedPosts.has(row.id), "Post identity mismatch");
      requireThat(row.createdUtc * 1000 >= start && row.createdUtc * 1000 < end, "Post outside collection window");
      requireThat(typeof row.permalink === "string" && row.permalink.toLowerCase().startsWith(`/r/${subreddit.toLowerCase()}/comments/${row.id}/`), "Invalid Reddit source link");
      requireThat(typeof row.title === "string" && integer(row.commentCount), "Invalid post metadata");
      usedPosts.add(row.id);
    }
    for (const row of commentRows) {
      requireThat(row.subreddit?.toLowerCase() === subreddit.toLowerCase() && /^[a-z0-9]+$/.test(row.id) && !usedComments.has(row.id) && postIds.has(row.postId), "Comment identity mismatch");
      requireThat(/^t[13]_[a-z0-9]+$/.test(row.parentId), "Invalid comment parent");
      requireThat(row.parentId.startsWith("t3_") ? row.parentId === `t3_${row.postId}` : !commentParents.has(row.parentId) || commentParents.get(row.parentId) === row.postId, "Comment parent belongs to another post");
      usedComments.add(row.id);
    }
    requireThat(integer(result.commentsSeen) && integer(result.commentsDropped) && result.commentsSeen === result.comments + result.commentsDropped, "Comment coverage counts mismatch");
    return {
      schema: "reddit-insights.snapshot.v1", subreddit, date, source: { run, attempt, revision },
      window: { start: manifest.windowStart, end: manifest.windowEnd, semantics: "collection-date; start-inclusive, end-exclusive" },
      capturedAt: manifest.generatedAt,
      coverage: { status: result.status, posts: result.posts, comments: result.comments,
        commentsSeen: result.commentsSeen, commentsDropped: result.commentsDropped,
        reportedReplies: postRows.reduce((sum, row) => sum + row.commentCount, 0),
        listingCapped: Boolean(result.listingCapped), commentFailures: result.commentFailures,
        unresolvedMore: result.unresolvedMore,
        note: "Captured posts in the collection window; retained comments are filtered and may be incomplete. Scores are recorded values, not current Reddit values." },
      posts: postRows.map(row => ({ ...project(row, POST_FIELDS), subreddit })),
      comments: commentRows.map(row => ({ ...project(row, COMMENT_FIELDS), subreddit })),
    };
  });
  requireThat(usedPosts.size === posts.length && usedComments.size === comments.length, "Unindexed archive rows");
  return snapshots;
}

export async function loadArchive(directory) {
  const manifestBytes = await readFile(join(directory, "manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  const indexBytes = await readFile(join(directory, "subreddits.index.json"));
  verifyFile(indexBytes, manifest.codec?.frameIndex);
  requireThat(manifest.codec.name === "zstd", "Unsupported archive codec");
  const decoded = {};
  // Verify every pack, including events, but only decode post/comment packs.
  for (const name of ["posts", "comments", "events"]) {
    const file = `${name}.jsonl.zst`, path = join(directory, file);
    const bytes = await readFile(path);
    requireThat(bytes.length <= MAX_PACK_BYTES, "Compressed archive exceeds limit");
    verifyFile(bytes, manifest.files.find(item => item.name === file));
    if (name !== "events") decoded[`${name}Bytes`] = execFileSync("zstd", ["-dc", "--", path], { maxBuffer: MAX_PACK_BYTES });
  }
  return projectArchive({ manifest, index: JSON.parse(indexBytes), ...decoded, revision: sha256(manifestBytes) });
}
