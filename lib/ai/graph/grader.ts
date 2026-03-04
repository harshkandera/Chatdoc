import { invokeModel } from "../models";
import type { SearchResult } from "../pinecone";
import type { ModelProvider } from "../model-options";

const SMALL_PROVIDER = (process.env.SMALL_MODEL_PROVIDER || "groq") as ModelProvider;
const SMALL_MODEL = process.env.SMALL_MODEL_ID || "llama-3.1-8b-instant";

/**
 * LLM Context Grader — the single source of truth for routing.
 *
 * Vector search answers: "Is this related?"
 * LLM grading answers: "Is this answerable?"
 * Agents answer: "How do we recover missing information?"
 *
 * Routing decisions must be made only after the LLM context grader.
 */
export async function gradeContextSufficiency(
  query: string,
  chunks: SearchResult[],
): Promise<boolean> {
  const context = chunks
    .slice(0, 5)
    .map((r) => r.metadata.content)
    .join("\n\n");

  if (!context.trim()) {
    return false;
  }

  try {
    const response = await invokeModel(
      SMALL_PROVIDER,
      [
        {
          role: "system",
          content: `You are a strict grading assistant.
Determine whether the retrieved documentation contains enough information to answer the user's question accurately and completely.

Return ONLY a JSON object: {"isSufficient": true} or {"isSufficient": false}

Rules:
- Return true ONLY if the documentation directly addresses the question with specific, actionable information
- Return false if the documentation is tangentially related but doesn't actually answer the question
- Return false if key details are missing (e.g. a specific number, config key, or step is asked for but not present)
- When in doubt, return false — it is better to search further than to produce an unsupported answer`,
        },
        {
          role: "user",
          content: `Question: ${query}\n\nRetrieved Documentation:\n${context}`,
        },
      ],
      SMALL_MODEL,
    );

    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return !!parsed.isSufficient;
    }
  } catch (error) {
    console.error(
      `❌ [grader] grade_context failed: ${(error as Error).message}`,
    );
  }
  // On failure → default to false (escalate rather than produce a bad answer)
  return false;
}
