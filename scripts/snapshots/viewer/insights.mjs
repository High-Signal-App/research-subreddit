const DAY = 86400000;
const finite = value => typeof value === "number" && Number.isFinite(value);
const percent = (part, total) => total > 0 ? Math.round(part / total * 100) : null;
const leader = (rows, field) => rows.length ? rows.slice().sort((a, b) => b[field] - a[field] || a.id.localeCompare(b.id))[0] : null;

/** Descriptive captured-record metrics. No sentiment, inferred topics or census claims. */
export function snapshotInsights(snapshot) {
  if (snapshot.coverage.status === "failed") return { available: false, reason: "Collection failed; there is not enough reliable evidence for insights." };
  const posts = snapshot.posts.filter(post => !post.removalState && post.title !== "[removed]" && post.body !== "[removed]" && post.body !== "[deleted]");
  if (!posts.length) return { available: false, reason: snapshot.posts.length ? "All captured posts were removed; no content insights are available." : "No posts were captured in this window, so there are no post insights to summarize." };
  if (!posts.every(post => finite(post.score) && finite(post.commentCount) && post.commentCount >= 0)) return { available: false, reason: "Recorded engagement values are incomplete; insights are unavailable." };
  const scores = posts.map(post => post.score).sort((a, b) => a - b);
  const middle = Math.floor(scores.length / 2);
  const medianScore = scores.length % 2 ? scores[middle] : (scores[middle - 1] + scores[middle]) / 2;
  const highestScore = leader(posts, "score"), mostDiscussed = leader(posts, "commentCount");
  const reportedReplies = posts.reduce((sum, post) => sum + post.commentCount, 0);
  const flairs = new Map();
  for (const post of posts) { const label = typeof post.flair === "string" && post.flair.trim() || "Unlabelled"; flairs.set(label, (flairs.get(label) || 0) + 1); }
  const contentMix = [...flairs].map(([label, count]) => ({ label, count, percent: percent(count, posts.length) })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { available: true, status: snapshot.coverage.status, posts: posts.length,
    excludedRemoved: snapshot.posts.length - posts.length, medianScore,
    lowScorePosts: scores.filter(score => score <= 1).length,
    highestScore: { id: highestScore.id, title: highestScore.title, score: highestScore.score },
    mostDiscussed: { id: mostDiscussed.id, title: mostDiscussed.title, replies: mostDiscussed.commentCount, share: percent(mostDiscussed.commentCount, reportedReplies) },
    reportedReplies, contentMix };
}

export function compareCollections(current, previous) {
  if (!previous) return { comparable: false, reason: "No earlier collection is available for this community." };
  if (current.subreddit.toLowerCase() !== previous.subreddit.toLowerCase()) return { comparable: false, reason: "Collections are from different communities." };
  if ([current, previous].some(snapshot => snapshot.coverage.status !== "complete" || snapshot.coverage.listingCapped)) return { comparable: false, reason: "A collection is partial or its post listing was capped; a change comparison would be misleading." };
  const start = Date.parse(current.window.start), end = Date.parse(current.window.end);
  const earlierStart = Date.parse(previous.window.start), earlierEnd = Date.parse(previous.window.end);
  // Daily cron start times drift slightly; expose this bounded tolerance in the UI.
  if (![start, end, earlierStart, earlierEnd].every(Number.isFinite) || end - start !== DAY || earlierEnd - earlierStart !== DAY || earlierEnd >= end || Math.abs(start - earlierEnd) > 60000) return { comparable: false, reason: "The available collections do not cover successive 24-hour windows; no change comparison is shown." };
  if (!previous.posts.length) return { comparable: false, reason: "The earlier collection captured no posts; a percentage change has no useful baseline." };
  if ([current, previous].some(snapshot => snapshot.posts.some(post => post.removalState || post.title === "[removed]" || post.body === "[removed]" || post.body === "[deleted]"))) return { comparable: false, reason: "A collection contains removed posts; no change comparison is shown." };
  return { comparable: true, previousDate: previous.date, previousPosts: previous.posts.length,
    currentPosts: current.posts.length, postChangePercent: Math.round((current.posts.length - previous.posts.length) / previous.posts.length * 100),
    note: "Change in captured post counts across successive 24-hour windows (aligned within one minute), not total subreddit activity. Filtered comment counts are not compared because filter-policy provenance is absent." };
}
