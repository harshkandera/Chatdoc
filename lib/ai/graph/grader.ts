import { ChatGroq } from "@langchain/groq";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { SearchResult } from "../pinecone";

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

  const model = new ChatGroq({
    model: "llama-3.1-8b-instant",
    temperature: 0,
  });

  try {
    const response = await model.invoke([
      new SystemMessage(
        `You are a strict grading assistant.
Determine whether the retrieved documentation contains enough information to answer the user's question accurately and completely.

Return ONLY a JSON object: {"isSufficient": true} or {"isSufficient": false}

Rules:
- Return true ONLY if the documentation directly addresses the question with specific, actionable information
- Return false if the documentation is tangentially related but doesn't actually answer the question
- Return false if key details are missing
- When in doubt, return false`,
      ),
      new HumanMessage(
        `Question: ${query}\n\nRetrieved Documentation:\n${context}`,
      ),
    ]);

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return !!parsed.isSufficient;
    }
  } catch (error) {
    console.error(
      `❌ [grader] grade_context failed: ${(error as Error).message}`,
    );
  }
  // On failure → default to false (safe escalation)
  return false;
}
