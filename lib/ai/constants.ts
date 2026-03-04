export const CONFIDENCE_HIGH_THRESHOLD = 0.35;
export const CONFIDENCE_MEDIUM_THRESHOLD = 0.2;

// Max web_search_docs calls before force-generating an answer
export const MAX_AGENT_HOPS = 2;

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
