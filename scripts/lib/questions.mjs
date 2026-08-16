const QUESTION_PATTERNS = [
  /\?\s*$/,
  /^(how|what|why|where|when|which|who|can|could|should|would|is|are|do|does|did|will|has|have)\b/i,
  /\b(?:anyone|any way|how do|how can|how to|what's the best|recommend|suggestion|advice|help me)\b/i,
  /\b(?:looking for|searching for|need (?:a|an|some|help))\b/i,
];

const ANNOUNCEMENT_PATTERNS = [
  /^(released|announced|launched|update|new|breaking|just (?:released|finished|posted|got))\b/i,
  /\b(?:now available|weights released|open sourced|just dropped|is out|is live)\b/i,
];

/** @param {string} text */
export function isQuestion(text) {
  if (text.length < 15) return false;
  if (text.trim().endsWith("?")) return true;
  const isQ = QUESTION_PATTERNS.some((pattern) => pattern.test(text));
  const isA = ANNOUNCEMENT_PATTERNS.some((pattern) => pattern.test(text));
  return isQ && !isA;
}
