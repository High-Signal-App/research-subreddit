import assert from "node:assert/strict";
import test from "node:test";

import { isQuestion } from "./questions.mjs";

test("treats explicit questions as questions", () => {
  assert.equal(isQuestion("How do I run Llama locally on a 16GB Mac?"), true);
});

test("rejects short or announcement-shaped titles", () => {
  assert.equal(isQuestion("New"), false);
  assert.equal(isQuestion("Released weights for the 70B model today"), false);
});
