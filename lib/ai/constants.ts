// ─── TELEMETRY-ONLY THRESHOLDS ───
// These thresholds are used for logging and telemetry.
// They do NOT participate in routing decisions.
// Routing is controlled by the LLM context grader (gradeContextSufficiency).
export const CONFIDENCE_HIGH_THRESHOLD = 0.35;
export const CONFIDENCE_MEDIUM_THRESHOLD = 0.2;

// @deprecated — no longer used for routing. Kept for telemetry/logging only.
export const VECTOR_CONFIDENCE_THRESHOLD = 0.35;
// @deprecated — no longer used for routing. Kept for telemetry/logging only.
export const RERANK_LOW_THRESHOLD = 0.15;

// @deprecated — replaced by LLM context grader. Kept for backward compat only.
export const WEAK_CONTEXT_SCORE_THRESHOLD = 0.25;

export const MAX_AGENT_HOPS = 5;

export function classifyConfidence(
  topScore: number,
): "high" | "medium" | "low" {
  if (topScore > CONFIDENCE_HIGH_THRESHOLD) return "high";
  if (topScore > CONFIDENCE_MEDIUM_THRESHOLD) return "medium";
  return "low";
}

export const INSUFFICIENT_ANSWER_PATTERNS = [
  "not contain enough information",
  "not enough information",
  "doesn't contain",
  "does not contain",
  "couldn't find relevant",
  "could not find relevant",
  "no relevant information",
  "not covered in",
  "not mentioned in",
  "doesn't mention",
  "does not mention",
  "not available in the",
  "outside the scope",
  "beyond the scope",
  "I don't have enough",
  "unable to find",
  "cannot answer",
  "can't answer",
];

export function isInsufficientAnswer(answer: string): boolean {
  const lower = answer.toLowerCase();
  return INSUFFICIENT_ANSWER_PATTERNS.some((pattern) => lower.includes(pattern));
}
