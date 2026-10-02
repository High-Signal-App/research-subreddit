#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { serveSnapshot } from "./snapshots/service.mjs";
import { parseSnapshotLocation } from "./snapshots/viewer/paths.mjs";

const { values } = parseArgs({ options: { port: { type: "string", default: "7425" }, "data-dir": { type: "string", default: "artifacts/daily-snapshots" } } });
const port = Number(values.port);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
const data = resolve(values["data-dir"]), viewer = join(dirname(fileURLToPath(import.meta.url)), "snapshots", "viewer");
const assets = { "/": ["home.html", "text/html"], "/snapshots/": ["index.html", "text/html"] };
for (const file of ["style.css", "theme.css", "home.css", "app.mjs", "paths.mjs", "insights.mjs", "home.mjs", "home-model.mjs"]) {
  assets[`/snapshots/${file}`] = [file, file.endsWith(".css") ? "text/css" : "text/javascript"];
}
assets["/snapshots/fonts/archivo.woff2"] = ["fonts/archivo.woff2", "font/woff2"];
assets["/snapshots/fonts/Archivo-OFL.txt"] = ["fonts/Archivo-OFL.txt", "text/plain"];
const get = async key => {
  try { return new Blob([await readFile(join(data, key))]).stream(); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/snapshots" || (url.pathname === "/" && ["subreddit", "date", "run", "revision"].some(key => url.searchParams.has(key)))) { res.writeHead(302, { Location: "/snapshots/" + url.search }); res.end(); return; }
    if (url.pathname.startsWith("/api/snapshots/")) {
      const response = await serveSnapshot(new Request(url, { method: req.method }), get);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const selection = parseSnapshotLocation(url);
    const asset = url.pathname.startsWith("/r/") && !selection.invalid ? assets["/snapshots/"] : assets[url.pathname];
    if (!asset || req.method !== "GET") { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": asset[1] + "; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(await readFile(join(viewer, asset[0])));
  } catch { res.writeHead(500); res.end("Snapshot service unavailable"); }
});
server.listen(port, "127.0.0.1", () => console.log(`Reddit Insights: http://127.0.0.1:${port}/`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
