import { serveSnapshot } from "../../../scripts/snapshots/service.mjs";

// Bind SNAPSHOT_EXPORTS to private, minimized derivatives at release time.
// No raw-archive key or user-supplied object path reaches the storage adapter.
export async function onRequest(context) {
  const bucket = context.env.SNAPSHOT_EXPORTS;
  const get = bucket ? async key => (await bucket.get(`reddit-insights/exports/v1/${key}`))?.body || null : null;
  return serveSnapshot(context.request, get);
}
