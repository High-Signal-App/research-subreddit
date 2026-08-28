import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailyDisplay, eventToDisplayPost } from './import-high-signal-daily.mjs';

const event = {
  source: 'reddit:technology',
  sourceUrl: 'https://www.reddit.com/r/technology/comments/abc/example/',
  publishedAt: '2026-08-28T00:00:00.000Z',
  retrievedAt: '2026-08-28T00:18:00.000Z',
  title: 'Example',
  content: 'Body',
  attention: { score: 42, commentCount: 12, upvoteRatio: 0.9 },
  archive: { schemaVersion: 2, date: '2026-08-28', postId: 'abc' },
};

test('maps the bounded High Signal event without pretending it is raw Reddit data', () => {
  const post = eventToDisplayPost(event);
  assert.equal(post.subreddit, 'technology');
  assert.equal(post.score, 42);
  assert.equal(post.high_signal_archive.postId, 'abc');
  assert.equal(post.author, null);
});

test('groups daily events into derived display corpora with explicit coverage', () => {
  const display = buildDailyDisplay([event], {
    archiveSchemaVersion: 2,
    archiveDate: '2026-08-28',
    windowStart: '2026-08-27T00:17:00.000Z',
    windowEnd: '2026-08-28T00:17:00.000Z',
  });
  assert.equal(display.get('technology').posts.length, 1);
  assert.equal(display.get('technology').coverage.rawArchiveDuplicated, false);
});
