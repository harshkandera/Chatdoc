type DecomposeReason =
  | "multiple_questions"
  | "numbered_questions"
  | "mixed_intents"
  | "error_plus_question"
  | "comparison"
  | "long_multi_intent";

export function shouldDecompose(prompt: string): {
  decompose: boolean;
  reasons: DecomposeReason[];
} {
  const reasons: DecomposeReason[] = [];
  const normalized = prompt.toLowerCase();

  // Basic stats
  const questionMarks = (prompt.match(/\?/g) || []).length;
  const wordCount = prompt.trim().split(/\s+/).length;

  // Patterns
  const numberedList = /\n?\s*\d+[\.\)]\s+/.test(prompt);
  const bulletList = /\n\s*[-*]\s+/.test(prompt);

  const multipleIntentWords =
    /(and also|additionally|another (question|thing)|furthermore|moreover|also,)/i.test(
      prompt,
    );

  const intentTransitions =
    /(how|why|when|what|should|can|does)\b.*\b(how|why|when|what|should|can|does)\b/i.test(
      normalized,
    );

  const comparisonPattern =
    /\b(vs|versus|difference between|compare|comparison)\b/i.test(normalized);

  const errorPattern =
    /(error|exception|traceback|typeerror|referenceerror|cannot read|failed to)/i.test(
      normalized,
    );

  // Rules
  if (questionMarks >= 2) {
    reasons.push("multiple_questions");
  }

  if (numberedList || bulletList) {
    reasons.push("numbered_questions");
  }

  if (multipleIntentWords || intentTransitions) {
    reasons.push("mixed_intents");
  }

  if (errorPattern && questionMarks >= 1 && wordCount > 40) {
    reasons.push("error_plus_question");
  }

  if (comparisonPattern) {
    reasons.push("comparison");
  }

  if (wordCount > 120 && reasons.length > 0) {
    reasons.push("long_multi_intent");
  }

  return {
    decompose: reasons.length > 0,
    reasons,
  };
}
