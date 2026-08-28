#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function jsonLines(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function eventToDisplayPost(event) {
  const subreddit = String(event.source || '').replace(/^reddit:/, '');
  if (!subreddit || !event.archive?.postId) throw new Error('invalid_high_signal_reddit_event');
  return {
    id: String(event.archive.postId),
    subreddit,
    title: String(event.title || ''),
    selftext: String(event.content || ''),
    url: event.attention?.outboundUrl || event.sourceUrl,
    permalink: event.sourceUrl,
    author: null,
    created_utc: Date.parse(event.publishedAt) / 1000,
    retrieved_at: event.retrievedAt,
    score: Number(event.attention?.score || 0),
    num_comments: Number(event.attention?.commentCount || 0),
    upvote_ratio: event.attention?.upvoteRatio ?? null,
    total_awards_received: Number(event.attention?.awardCount || 0),
    link_flair_text: event.attention?.flair ?? null,
    high_signal_archive: event.archive,
  };
}

export function buildDailyDisplay(events, pointer) {
  const communities = new Map();
  for (const event of events) {
    const post = eventToDisplayPost(event);
    const rows = communities.get(post.subreddit) || [];
    rows.push(post);
    communities.set(post.subreddit, rows);
  }
  return new Map(
    [...communities].map(([subreddit, posts]) => [
      subreddit,
      {
        posts,
        coverage: {
          source: 'high-signal-reddit-archive',
          archiveSchemaVersion: pointer.archiveSchemaVersion,
          archiveDate: pointer.archiveDate,
          windowStart: pointer.windowStart,
          windowEnd: pointer.windowEnd,
          sampling: 'qualified attention events from one exact daily archive window',
          rawArchiveDuplicated: false,
        },
      },
    ])
  );
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--events') options.events = resolve(argv[++index]);
    else if (argv[index] === '--pointer') options.pointer = resolve(argv[++index]);
    else if (argv[index] === '--output-dir') options.outputDir = resolve(argv[++index]);
    else if (argv[index] === '--render') options.render = argv[++index];
    else throw new Error(`unknown_argument:${argv[index]}`);
  }
  if (!options.events || !options.pointer || !options.outputDir) {
    throw new Error('usage: --events PATH --pointer PATH --output-dir PATH [--render SUBREDDIT]');
  }
  return options;
}

function readEvents(path) {
  if (!existsSync(path)) throw new Error(`events_not_found:${path}`);
  const text = path.endsWith('.zst')
    ? execFileSync('zstd', ['-d', '-q', '-c', path], { maxBuffer: 256 * 1024 * 1024 }).toString(
        'utf8'
      )
    : readFileSync(path, 'utf8');
  return jsonLines(text);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const pointer = JSON.parse(readFileSync(options.pointer, 'utf8'));
  const display = buildDailyDisplay(readEvents(options.events), pointer);
  const displayDir = join(options.outputDir, 'display');
  const memoryDir = join(options.outputDir, 'memory');
  mkdirSync(displayDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });
  for (const [subreddit, payload] of display) {
    writeFileSync(
      join(displayDir, `${subreddit}.json.gz`),
      gzipSync(JSON.stringify(payload), { level: 9 })
    );
  }
  writeFileSync(
    join(displayDir, 'index.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        source: 'high-signal-reddit-archive',
        archiveDate: pointer.archiveDate,
        communities: [...display.keys()].sort(),
        eventCount: [...display.values()].reduce((sum, payload) => sum + payload.posts.length, 0),
      },
      null,
      2
    ) + '\n'
  );
  if (options.render) {
    if (!display.has(options.render))
      throw new Error(`render_community_not_found:${options.render}`);
    execFileSync('node', [join(process.cwd(), 'scripts', 'reddit-memory-ui.mjs'), options.render], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        REDDIT_DATA_DIR: memoryDir,
        REDDIT_DISPLAY_DIR: displayDir,
        REDDIT_RENDER_ONLY: '1',
      },
      stdio: 'inherit',
    });
  }
  console.log(
    JSON.stringify({
      event: 'high_signal_daily_import_complete',
      input: basename(options.events),
      archiveDate: pointer.archiveDate,
      communities: display.size,
      events: [...display.values()].reduce((sum, payload) => sum + payload.posts.length, 0),
      rendered: options.render || null,
      outputDir: options.outputDir,
    })
  );
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
