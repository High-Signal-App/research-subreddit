import { serveSnapshot } from "../../../scripts/snapshots/service.mjs";

const CATALOG_PATH = "/api/snapshots/catalog";

// Bind SNAPSHOT_EXPORTS to private, minimized derivatives at release time.
// No raw-archive key or user-supplied object path reaches the storage adapter.
export async function onRequest(context) {
  const bucket = context.env.SNAPSHOT_EXPORTS;
  const get = bucket ? async key => (await bucket.get(`reddit-insights/exports/v1/${key}`))?.body || null : null;
  const url = new URL(context.request.url);
  // The catalog is identical for every visitor; keep a colo-local copy for its s-maxage.
  const cache = context.request.method === "GET" && url.pathname === CATALOG_PATH && !url.search ? globalThis.caches?.default : undefined;
  const cacheKey = cache ? new Request(`${url.origin}${CATALOG_PATH}`) : undefined;
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const response = new Response(hit.body, hit);
        response.headers.set("Server-Timing", 'cache;desc="HIT"');
        return response;
      }
    } catch { /* Cache failures fall through to storage. */ }
  }
  const response = await serveSnapshot(context.request, get);
  if (cache && response.status === 200) {
    response.headers.set("Server-Timing", `${response.headers.get("Server-Timing")}, cache;desc="MISS"`);
    const stored = cache.put(cacheKey, response.clone()).catch(() => {});
    if (context.waitUntil) context.waitUntil(stored);
  }
  return response;
}
