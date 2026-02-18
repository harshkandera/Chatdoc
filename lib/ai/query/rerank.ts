import { invokeModel, ModelProvider } from "../models";
import { SearchResult } from "../pinecone";

export interface RerankResult {
  chunk: SearchResult;
  relevanceScore: number;
  index: number;
}

/**
 * Rerank search results using LLM-based relevance scoring
 * This is a cost-effective alternative to Cohere/Jina rerankers
 */
export async function rerankWithLLM(
  query: string,
  chunks: SearchResult[],
  topK: number = 5,
  provider: ModelProvider = "groq",
): Promise<RerankResult[]> {
  if (chunks.length === 0) return [];
  if (chunks.length <= topK) {
    // No need to rerank if we have fewer chunks than needed
    return chunks.map((chunk, index) => ({
      chunk,
      relevanceScore: chunk.score,
      index,
    }));
  }

  // Build prompt for relevance scoring
  const documentsText = chunks
    .map(
      (chunk, i) =>
        `[${i}] ${chunk.metadata.title}\n${chunk.metadata.content.slice(0, 500)}...`,
    )
    .join("\n\n");

  const response = await invokeModel(provider, [
    {
      role: "system",
      content: `You are a relevance scorer. Given a query and documents, rate each document's relevance to the query.

Return ONLY a JSON array of objects with "index" and "score" (0-10).
Higher score = more relevant to answering the query.
Consider: direct answer, supporting context, code examples matching the query.

Example output: [{"index": 0, "score": 9}, {"index": 1, "score": 3}]`,
    },
    {
      role: "user",
      content: `Query: ${query}\n\nDocuments:\n${documentsText}`,
    },
  ]);

  try {
    // Parse scores from LLM response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON found");

    const scores: { index: number; score: number }[] = JSON.parse(jsonMatch[0]);

    // Map scores to chunks
    const reranked: RerankResult[] = scores
      .filter((s) => s.index >= 0 && s.index < chunks.length)
      .map((s) => ({
        chunk: chunks[s.index],
        relevanceScore: s.score / 10, // Normalize to 0-1
        index: s.index,
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, topK);

    return reranked;
  } catch (error) {
    console.error("Rerank parsing failed:", error);
    // Fallback: return top chunks by original score
    return chunks.slice(0, topK).map((chunk, index) => ({
      chunk,
      relevanceScore: chunk.score,
      index,
    }));
  }
}


/**
 * Optional: Cohere Reranker (better quality, requires API key)
 * Install: pnpm add cohere-ai
 */


export async function rerankWithCohere(
  query: string,
  chunks: SearchResult[],
  topK: number = 5,
): Promise<RerankResult[]> {
  // Requires COHERE_API_KEY in .env
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    console.warn("COHERE_API_KEY not set, falling back to LLM rerank");
    return rerankWithLLM(query, chunks, topK);
  }

  const response = await fetch("https://api.cohere.ai/v1/rerank", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "rerank-english-v3.0",
      query,
      documents: chunks.map((c) => c.metadata.content),
      top_n: topK,
    }),
  });

  if (!response.ok) {
    console.error("Cohere rerank failed:", await response.text());
    return rerankWithLLM(query, chunks, topK);
  }

  const data = await response.json();

  return data.results.map((r: { index: number; relevance_score: number }) => ({
    chunk: chunks[r.index],
    relevanceScore: r.relevance_score,
    index: r.index,
  }));
}

/**
 * Main rerank function - uses Cohere if available, else LLM
 */
export async function rerank(
  query: string,
  chunks: SearchResult[],
  topK: number = 5,
  provider: ModelProvider = "groq",
): Promise<RerankResult[]> {
  if (process.env.COHERE_API_KEY) {
    return rerankWithCohere(query, chunks, topK);
  }
  return rerankWithLLM(query, chunks, topK, provider);
}
