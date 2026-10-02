import { validDate } from "./paths.mjs";
import { snapshotInsights } from "./insights.mjs";

/** Only unexpired catalog entries can be offered as available collections. */
export function availableCollections(entries, now = Date.now()) {
  return entries.filter(entry => /^[A-Za-z0-9_]{2,30}$/.test(entry.subreddit || "") && validDate(entry.date)
    && /^\d+$/.test(entry.source?.run || "") && /^[a-f0-9]{64}$/.test(entry.source?.revision || "")
    && Date.parse(entry.expiresAt) > now)
    .sort((a, b) => b.date.localeCompare(a.date) || a.subreddit.localeCompare(b.subreddit));
}

export function collectionDates(entries, subreddit) {
  return [...new Set(entries.filter(entry => entry.subreddit === subreddit).map(entry => entry.date))].sort().reverse();
}

/** Redacted and failed records never become landing-page proof. */
export function collectionPreview(snapshot) {
  const insights = snapshotInsights(snapshot);
  if (!insights.available) return { posts: [], leader: null, reason: insights.reason };
  const posts = snapshot.posts.filter(post => !post.removalState && post.title !== "[removed]" && post.body !== "[removed]" && post.body !== "[deleted]");
  return {
    posts: posts.slice().sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 3),
    leader: posts.find(post => post.id === insights.mostDiscussed.id),
    reason: null,
  };
}
