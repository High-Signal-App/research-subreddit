import assert from "node:assert/strict";
import test from "node:test";
import { RawImage } from "@huggingface/transformers";

test("Transformers decodes and resizes a synthetic PNG through its native image path", async () => {
  const fixture = new RawImage(
    new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
    2,
    2,
    3,
  );
  const png = await fixture.toSharp().png().toBuffer();
  const decoded = await RawImage.read(new Blob([png]));

  assert.deepEqual(decoded.size, [2, 2]);
  assert.equal(decoded.channels, 3);
  assert.equal(decoded.data.length, 2 * 2 * 3);
  assert.deepEqual(Array.from(decoded.data), Array.from(fixture.data));

  const resized = await decoded.resize(3, 2, { resample: "lanczos" });
  assert.deepEqual(resized.size, [3, 2]);
  assert.equal(resized.channels, 3);
  assert.equal(resized.data.length, 3 * 2 * 3);
});
