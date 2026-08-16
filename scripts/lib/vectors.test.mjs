import assert from "node:assert/strict";
import test from "node:test";

import { cosine, hashText } from "./vectors.mjs";

test("hashText is stable and short", () => {
  assert.equal(hashText("hello"), hashText("hello"));
  assert.notEqual(hashText("hello"), hashText("world"));
  assert.equal(hashText("hello").length, 16);
});

test("cosine of identical unit vectors is 1", () => {
  const vector = Float32Array.from([1, 0]);
  assert.equal(cosine(vector, vector), 1);
});
