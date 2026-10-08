#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { loadArchive } from "./snapshots/archive.mjs";
import { prepareSnapshots } from "./snapshots/publication.mjs";

const { values } = parseArgs({ options: { "archive-dir": { type: "string" }, "output-dir": { type: "string", default: "artifacts/daily-snapshots" } } });
if (!values["archive-dir"]) throw new Error("Usage: pnpm run snapshots:import -- --archive-dir <verified daily archive directory> [--output-dir <private derivatives directory>]");
const directory = resolve(values["output-dir"]);
const snapshots = await loadArchive(resolve(values["archive-dir"]));
const prepared = prepareSnapshots(snapshots);
await mkdir(directory, { recursive: true });
let catalog = { schema: "reddit-insights.catalog.v1", entries: [] };
try { catalog = JSON.parse(await readFile(join(directory, "index.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (catalog.schema !== "reddit-insights.catalog.v1" || !Array.isArray(catalog.entries)) throw new Error("Invalid existing snapshot catalog");
for (const { bytes, entry } of prepared) {
  const path = join(directory, entry.key);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path + ".next", bytes);
  await rename(path + ".next", path);
  // Re-import/redaction replaces this source run; old revisions become unservable.
  catalog.entries = catalog.entries.filter(previous => !(previous.subreddit === entry.subreddit && previous.date === entry.date && previous.source.run === entry.source.run));
  catalog.entries.push(entry);
}
catalog.generatedAt = new Date().toISOString();
catalog.entries.sort((a, b) => b.date.localeCompare(a.date) || b.capturedAt.localeCompare(a.capturedAt) || a.subreddit.localeCompare(b.subreddit));
await writeFile(join(directory, "index.json.next"), JSON.stringify(catalog));
await rename(join(directory, "index.json.next"), join(directory, "index.json"));
console.log(`Verified and prepared ${prepared.length} subreddit snapshots for ${snapshots[0].date}. Exports expire after 24 hours; re-import from the authoritative archive to refresh.`);
