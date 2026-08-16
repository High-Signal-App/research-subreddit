import { createHash } from "node:crypto";

/** @param {string} text */
export function hashText(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** @param {ArrayLike<number>} a @param {ArrayLike<number>} b */
export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
