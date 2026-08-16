import { join } from "node:path";

/** @param {string} [cwd] */
export function memoryDir(cwd = process.cwd()) {
  return join(cwd, "data", "reddit-memory");
}

/** @param {string} subreddit @param {string} [cwd] */
export function storageFile(subreddit, cwd = process.cwd()) {
  return join(memoryDir(cwd), `${subreddit}.json`);
}

/** @param {string} subreddit @param {string} [cwd] */
export function embeddingCacheFile(subreddit, cwd = process.cwd()) {
  return join(memoryDir(cwd), "cache", `${subreddit}-embeddings.json`);
}
