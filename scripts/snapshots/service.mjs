// Web-standard serving boundary shared by the local server and Pages Functions.
import { VERSION_PATTERN } from "./viewer/paths.mjs";
const MAX_BYTES = 8 * 1024 * 1024;
const BASE = "/api/snapshots/";
const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" };
const json = (value, status = 200) => Response.json(value, { status, headers });
const fail = (code, message, status) => json({ error: code, message }, status);
export const publicEntry = ({ key, sha256, bytes, storedAt, ...entry }) => entry;

export function csv(rows, fields, snapshot) {
  const meta = { subreddit: snapshot.subreddit, date: snapshot.date, run: snapshot.source.run,
    revision: snapshot.source.revision, windowStart: snapshot.window.start, windowEnd: snapshot.window.end,
    coverageStatus: snapshot.coverage.status };
  const columns = [...Object.keys(meta), ...fields.filter(field => field !== "subreddit")];
  const cell = value => {
    let text = value == null ? "" : String(value);
    // Spreadsheet formula injection applies to strings, including leading whitespace.
    if (typeof value === "string" && (/^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return "\uFEFF" + [columns.map(cell).join(","), ...rows.map(row => columns.map(key => cell({ ...row, ...meta }[key])).join(","))].join("\r\n") + "\r\n";
}

export async function readBounded(stream, limit = MAX_BYTES) {
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error("Export size exceeded"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

/** get(key) returns a byte stream or null; only catalogued keys can be requested. */
export async function serveSnapshot(request, get, now = Date.now()) {
  if (request.method !== "GET") return fail("method", "Use GET to read a snapshot.", 405);
  const url = new URL(request.url);
  if (!url.pathname.startsWith(BASE)) return fail("missing", "Snapshot route not found.", 404);
  const route = url.pathname.slice(BASE.length);
  if (route !== "catalog" && !/^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_]{2,30}$/.test(route)) return fail("invalid", "Choose a valid collection date and subreddit.", 400);
  const version = url.searchParams.get("v");
  if (version !== null && !VERSION_PATTERN.test(version)) return fail("invalid", "Choose a valid snapshot version.", 400);
  if (!get) return fail("unavailable", "Snapshot storage is unavailable. Please try again later.", 503);
  try {
    const catalogStream = await get("index.json");
    if (!catalogStream) return fail("unavailable", "No snapshot catalog is available yet.", 503);
    const catalog = JSON.parse(new TextDecoder().decode(await readBounded(catalogStream, 4 * 1024 * 1024)));
    if (catalog.schema !== "reddit-insights.catalog.v1" || !Array.isArray(catalog.entries)) throw new Error("Invalid catalog");
    if (route === "catalog") return json({ schema: catalog.schema, generatedAt: catalog.generatedAt, entries: catalog.entries.map(publicEntry) });
    const [date, subreddit] = route.split("/");
    const run = url.searchParams.get("run"), revision = url.searchParams.get("revision");
    const entries = catalog.entries.filter(entry => entry.date === date && entry.subreddit.toLowerCase() === subreddit.toLowerCase());
    const matches = entries.filter(entry => (!run || entry.source.run === run) && (!revision || entry.source.revision === revision) && (!version || entry.source.revision.startsWith(version)));
    if (version && matches.length > 1) return fail("ambiguous", "This short snapshot version is ambiguous. Open the collection by date instead.", 409);
    const entry = matches[0];
    if (!entry) return fail(run || revision || version ? "removed" : "missing", run || revision || version ? "This snapshot revision is no longer available." : "No collection was archived for this subreddit on this date.", run || revision || version ? 410 : 404);
    if (!(Date.parse(entry.expiresAt) > now)) return fail("expired", "This export has expired. It needs to be refreshed from the archive.", 410);
    const expectedKey = `snapshots/${entry.date}/${entry.subreddit}/${entry.source.run}-${entry.source.revision}.json.gz`;
    if (entry.key !== expectedKey || !/^[a-f0-9]{64}$/.test(entry.source.revision) || !/^\d+$/.test(entry.source.run)) throw new Error("Invalid export key");
    const stream = await get(entry.key);
    if (!stream) return fail("unavailable", "The selected snapshot is temporarily unavailable.", 503);
    const compressed = await readBounded(stream);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", compressed)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (compressed.length !== entry.bytes || digest !== entry.sha256) throw new Error("Snapshot checksum mismatch");
    const decoded = await readBounded(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")));
    const snapshot = JSON.parse(new TextDecoder().decode(decoded));
    if (snapshot.schema !== "reddit-insights.snapshot.v1" || snapshot.date !== entry.date || snapshot.subreddit !== entry.subreddit || JSON.stringify(snapshot.source) !== JSON.stringify(entry.source) || snapshot.posts.length !== entry.coverage.posts || snapshot.comments.length !== entry.coverage.comments) throw new Error("Snapshot identity mismatch");
    const format = url.searchParams.get("format") || "json";
    if (!["json", "posts.csv", "comments.csv"].includes(format)) return fail("invalid", "Choose JSON, posts.csv or comments.csv.", 400);
    if (format === "json" && !url.searchParams.has("download")) return json({ ...snapshot, expiresAt: entry.expiresAt });
    const filename = `${entry.subreddit}-${date}-${entry.source.run}-${format === "json" ? "snapshot.json" : format}`;
    const body = format === "json" ? JSON.stringify({ ...snapshot, expiresAt: entry.expiresAt }, null, 2) : csv(snapshot[format.split(".")[0]], format === "posts.csv" ? POST_CSV : COMMENT_CSV, snapshot);
    return new Response(body, { headers: { ...headers, "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` } });
  } catch {
    return fail("unavailable", "Snapshot data could not be verified or storage is unavailable.", 503);
  }
}

const POST_CSV = ["id", "title", "body", "permalink", "createdUtc", "retrievedAt", "score", "upvoteRatio", "commentCount", "flair", "nsfw", "spoiler", "removalState"];
const COMMENT_CSV = ["id", "postId", "parentId", "body", "createdUtc", "retrievedAt", "score", "depth", "isSubmitter", "removalState"];
