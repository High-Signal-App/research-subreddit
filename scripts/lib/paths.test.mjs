import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { embeddingCacheFile, memoryDir, storageFile } from "./paths.mjs";

test("memory paths stay under data/reddit-memory", () => {
  const root = "/tmp/reddit-insights";
  assert.equal(memoryDir(root), join(root, "data", "reddit-memory"));
  assert.equal(
    storageFile("LocalLLaMA", root),
    join(root, "data", "reddit-memory", "LocalLLaMA.json"),
  );
  assert.equal(
    embeddingCacheFile("LocalLLaMA", root),
    join(root, "data", "reddit-memory", "cache", "LocalLLaMA-embeddings.json"),
  );
});
