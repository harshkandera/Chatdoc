import { invokeModel, ModelProvider } from "../models";

export interface DecomposedQuery {
  query: string;
  intent: string;
  type: "factual" | "comparison" | "how_to" | "error" | "concept";
  priority: 1 | 2;
}

const DECOMPOSE_PROMPT = `You are a query analyzer. Break down the user's complex question into individual search queries.

Rules:
- Each query should be 5-15 words, optimized for semantic search
- Each query should be self-contained (can be searched independently)
- Return ONLY a JSON array with this structure:

{
  "query": "short search query",
  "intent": "what the user wants to know",
  "type": "factual|comparison|how_to|error|concept",
  "priority": 1 or 2 (1 = must answer, 2 = nice to have)
}

- Maximum 5 queries
- Only include queries that are actually asked
- Do not include any other text, markdown, or code block markers. Just the raw JSON array.

User prompt:`;

export async function decomposeQuery(
  prompt: string,
  provider: ModelProvider = (process.env.SMALL_MODEL_PROVIDER || "groq") as ModelProvider,
): Promise<DecomposedQuery[]> {
  const modelId = provider === "ollama" ? (process.env.SMALL_MODEL_ID || undefined) : undefined;
  const response = await invokeModel(provider, [
    {
      role: "system",
      content: DECOMPOSE_PROMPT,
    },
    {
      role: "user",
      content: prompt,
    },
  ], modelId);

  try {
    // Basic cleanup to remove markdown code blocks if present
    const cleanedResponse = response.replace(/```json\n?|```/g, "").trim();

    // Extract JSON from response
    const jsonMatch = cleanedResponse.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      console.warn("No JSON array found in response:", response);
      throw new Error("No JSON array found in response");
    }
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("Failed to parse decomposed queries:", error);
    // Fallback: return the original prompt as a single query
    return [
      {
        query: prompt.slice(0, 100),
        intent: "answer the question",
        type: "factual",
        priority: 1,
      },
    ];
  }
}
