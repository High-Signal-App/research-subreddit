import { gzipSync } from "node:zlib";
import { MAX_SNAPSHOT_BYTES, sha256 } from "./archive.mjs";
import { validDate } from "./viewer/paths.mjs";

export const EXPORT_PREFIX = "reddit-insights/exports/v1/";
export const LEASE_MS = 86400000;
export const RETOUCH_MS = 5 * LEASE_MS;

export function archivePrefix(entry) {
  if (!validDate(entry.date) || !/^[1-9][0-9]*$/.test(entry.source?.run || "") || !/^[1-9][0-9]*$/.test(entry.source?.attempt || "")) throw new Error("Invalid source archive identity");
  return `reddit/v2/run=${entry.source.run}/attempt=${entry.source.attempt}/date=${entry.date}`;
}

export function verifyCatalog(catalog) {
  if (catalog.schema !== "reddit-insights.catalog.v1" || !Array.isArray(catalog.entries)) throw new Error("Invalid export catalog");
  const keys = new Set();
  for (const entry of catalog.entries) {
    archivePrefix(entry);
    if (!/^[A-Za-z0-9_]{2,30}$/.test(entry.subreddit) || !/^[a-f0-9]{64}$/.test(entry.source.revision) || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || entry.key !== `snapshots/${entry.date}/${entry.subreddit}/${entry.source.run}-${entry.source.revision}.json.gz`
      || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > MAX_SNAPSHOT_BYTES || keys.has(entry.key)) throw new Error("Invalid catalogued export");
    keys.add(entry.key);
  }
  return catalog;
}

export function prepareSnapshots(snapshots, now = Date.now()) {
  return snapshots.map(snapshot => {
    const body = Buffer.from(JSON.stringify(snapshot));
    if (body.length > MAX_SNAPSHOT_BYTES) throw new Error(`Snapshot exceeds bounded export size: ${snapshot.subreddit}`);
    const bytes = gzipSync(body, { level: 9 });
    const key = `snapshots/${snapshot.date}/${snapshot.subreddit}/${snapshot.source.run}-${snapshot.source.revision}.json.gz`;
    return { bytes, entry: { subreddit: snapshot.subreddit, date: snapshot.date, source: snapshot.source,
      capturedAt: snapshot.capturedAt, coverage: snapshot.coverage, key, sha256: sha256(bytes), bytes: bytes.length,
      storedAt: new Date(now).toISOString(), expiresAt: new Date(now + LEASE_MS).toISOString() } };
  });
}

export function replaceSource(catalog, prepared) {
  const prefixes = new Set(prepared.map(item => archivePrefix(item.entry)));
  return { schema: "reddit-insights.catalog.v1", entries: [...catalog.entries.filter(entry => !prefixes.has(archivePrefix(entry))), ...prepared.map(item => item.entry)] };
}

/** Lease renewal is permitted only after rereading the authoritative manifest. */
export function renewSource(entries, manifestBytes, now = Date.now()) {
  const manifest = JSON.parse(manifestBytes);
  const revision = sha256(manifestBytes);
  if (!entries.length || entries.some(entry => archivePrefix(entry) !== manifest.objectPrefix || entry.source.revision !== revision)) return null;
  return entries.map(entry => ({ ...entry, expiresAt: new Date(now + LEASE_MS).toISOString() }));
}

/** Catalog is committed last; interrupted object uploads cannot switch readers. */
export async function publishPrepared(catalog, prepared, put, verify) {
  verifyCatalog(catalog);
  for (let start = 0; start < prepared.length; start += 4) {
    const results = await Promise.allSettled(prepared.slice(start, start + 4).map(item => put(EXPORT_PREFIX + item.entry.key, item.bytes)));
    const failed = results.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
  }
  if (prepared.length) await verify(prepared.find(item => item.entry.subreddit === "AI_Agents") || prepared[0]);
  await put(EXPORT_PREFIX + "index.json", Buffer.from(JSON.stringify(verifyCatalog(catalog))));
}
