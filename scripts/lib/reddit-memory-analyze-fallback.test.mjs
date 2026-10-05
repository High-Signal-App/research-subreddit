import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const analyzeScript = fileURLToPath(
  new URL("../reddit-memory-analyze.mjs", import.meta.url),
);

test("invalid embedding cache falls back to recompute and preserves inputs if inference fails", (t) => {
  const root = mkdtempSync(join(tmpdir(), "reddit-analyze-fallback-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const subreddit = "synthetic-r4";
  const dataDir = join(root, "data", "reddit-memory");
  const cacheDir = join(dataDir, "cache");
  mkdirSync(cacheDir, { recursive: true });
  const sourceFile = join(dataDir, `${subreddit}.json`);
  const sourceBytes = JSON.stringify({
    posts: [
      {
        id: "synthetic-post",
        title: "Synthetic fixture: does fallback preserve its source data?",
        selftext: "",
        created_utc: 1_760_000_000,
        score: 1,
        comments: [],
      },
    ],
  });
  writeFileSync(sourceFile, sourceBytes);

  const cacheFile = join(cacheDir, `${subreddit}-embeddings.json`);
  const invalidCache = "{ synthetic invalid cache";
  writeFileSync(cacheFile, invalidCache);

  const loaderFile = join(root, "mock-transformers-loader.mjs");
  writeFileSync(
    loaderFile,
    `export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@huggingface/transformers") {
    return { url: new URL("./mock-transformers.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`,
  );
  writeFileSync(
    join(root, "mock-transformers.mjs"),
    `export async function pipeline() {
  throw new Error("synthetic_model_load_failure");
}
`,
  );

  const result = spawnSync(
    process.execPath,
    ["--no-warnings", "--loader", loaderFile, analyzeScript, subreddit],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        XDG_CACHE_HOME: join(root, ".cache"),
      },
    },
  );

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stdout,
    /embedding cache: failed to load, starting fresh/,
    result.stderr,
  );
  assert.match(result.stdout, /loading model\.\.\./);
  assert.match(result.stderr, /Failed: synthetic_model_load_failure/);
  assert.equal(readFileSync(sourceFile, "utf8"), sourceBytes);
  assert.equal(readFileSync(cacheFile, "utf8"), invalidCache);
  assert.equal(existsSync(join(dataDir, `${subreddit}-report.json`)), false);
});
