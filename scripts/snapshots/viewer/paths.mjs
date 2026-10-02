export const VERSION_PATTERN = /^[a-f0-9]{12}$/;
const communityPattern = /^[A-Za-z0-9_]{2,30}$/;
export function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || "") && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}

/** Clean routes and earlier query links share one validated identity parser. */
export function parseSnapshotLocation(input) {
  const url = new URL(input, "http://localhost");
  const match = /^\/r\/([^/]+)\/(\d{4}-\d{2}-\d{2})(?:\/([a-f0-9]{12}))?\/?$/.exec(url.pathname);
  if (match) {
    const [, subreddit, date, version] = match;
    return communityPattern.test(subreddit) && validDate(date) ? { subreddit, date, version, pinned: Boolean(version) } : { invalid: true };
  }
  if (!["/", "/snapshots", "/snapshots/"].includes(url.pathname)) return { invalid: true };
  const query = url.searchParams;
  const selection = Object.fromEntries(["subreddit", "date", "run", "revision"].filter(key => query.has(key)).map(key => [key, query.get(key)]));
  if ((selection.subreddit && !communityPattern.test(selection.subreddit)) || (selection.date && !validDate(selection.date)) || (selection.run && !/^\d+$/.test(selection.run)) || (selection.revision && !/^[a-f0-9]{64}$/.test(selection.revision))) return { invalid: true };
  return { ...selection, pinned: Boolean(selection.run || selection.revision) };
}

export function snapshotPath(snapshot, exact = false) {
  if (!communityPattern.test(snapshot.subreddit) || !validDate(snapshot.date)) throw new Error("Invalid snapshot address");
  const base = `/r/${snapshot.subreddit}/${snapshot.date}/`;
  if (!exact) return base;
  if (!/^[a-f0-9]{64}$/.test(snapshot.source?.revision || "")) throw new Error("Invalid snapshot revision");
  return base + snapshot.source.revision.slice(0, 12) + "/";
}

export function snapshotPostPath(snapshot, postId) {
  if (!/^[a-z0-9]{1,32}$/.test(postId || "")) throw new Error("Invalid post address");
  return snapshotPath(snapshot, true) + `#post-${postId}`;
}
