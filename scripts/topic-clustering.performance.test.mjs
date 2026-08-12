import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { summarizeTopicAssignments } from "./topic-clustering.mjs";

const SIZES = [1_000, 5_000, 20_000];
const ITERATIONS = 20;
const TOPIC_LABELS = Array.from({ length: 12 }, (_, index) => `Topic ${index}`);
const EXPECTED_HASHES = new Map([
  [1_000, "3332f085315031b6c0353c630854115ab5e452851c395ee7f9b4683fce02b9c7"],
  [5_000, "351be4a6288c236dda34475efaebd84def556409f90106b27ea9ad64a6dbe4c0"],
  [20_000, "6be56b7268aad73e08f141dde60d179cc7c74cfd4282d1bc3cbab1f471baa0d9"],
]);

test("topic summarization scales across a representative text corpus", () => {
  const metrics = [];

  for (const size of SIZES) {
    const texts = Array.from(
      { length: size },
      (_, index) => `Text ${index} ${"detail ".repeat(index % 25)}`,
    );
    const assignments = Array.from({ length: size }, (_, index) => ({
      topicIdx: (index * 7) % TOPIC_LABELS.length,
      sim: ((index * 997) % 10_000) / 10_000,
    }));
    const expected = summarizeTopicAssignments(TOPIC_LABELS, texts, assignments);
    const outputHash = createHash("sha256")
      .update(JSON.stringify(expected))
      .digest("hex");
    assert.equal(outputHash, EXPECTED_HASHES.get(size));

    const startedAt = performance.now();
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      assert.deepEqual(
        summarizeTopicAssignments(TOPIC_LABELS, texts, assignments),
        expected,
      );
    }
    metrics.push(
      `size${size}=${((performance.now() - startedAt) / ITERATIONS).toFixed(3)}ms/op`,
    );
  }

  console.log(`[benchmark] ${metrics.join(" ")} (${ITERATIONS} iterations)`);
  console.log(`[resource] representative_texts=${SIZES.at(-1)}`);
});
