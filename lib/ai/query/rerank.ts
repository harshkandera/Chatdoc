import { invokeModel, ModelProvider } from "../models";
import { SearchResult } from "../pinecone";
import { traceable } from "langsmith/traceable";

export interface RerankResult {
  chunk: SearchResult;
  relevanceScore: number;
  index: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Cohere rerank model — override via env for multilingual support */
const COHERE_MODEL = process.env.COHERE_RERANK_MODEL || "rerank-english-v3.0";

/** Timeout for Cohere API calls (ms) */
const COHERE_TIMEOUT_MS = 8_000;

/** Max documents Cohere accepts per request */
const COHERE_MAX_DOCS = 100;

// ─── Cohere Reranker (Primary) ────────────────────────────────────────────────

/**
 * Rerank using Cohere's dedicated rerank API.
 * This is significantly better than LLM-based reranking:
 * - Purpose-built model trained specifically for relevance scoring
 * - ~100ms latency vs ~500-1000ms for an LLM call
 * - Deterministic scores (no JSON parsing failures)
 * - Supports up to 100 documents per call
 *
 * Falls back to LLM rerank if Cohere fails.
 */
export const rerankWithCohere = traceable(
  async (
    query: string,
    chunks: SearchResult[],
    topK: number = 5,
  ): Promise<RerankResult[]> => {
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) {
      console.warn(
        "[Rerank] COHERE_API_KEY not set, falling back to LLM rerank",
      );
      return rerankWithLLM(query, chunks, topK);
    }

    // Guard: no work needed
    if (chunks.length === 0) return [];
    if (chunks.length <= topK) {
      return chunks.map((chunk, index) => ({
        chunk,
        relevanceScore: chunk.score,
        index,
      }));
    }

    // Cohere accepts max 100 docs — truncate if needed
    const docsToRank = chunks.slice(0, COHERE_MAX_DOCS);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), COHERE_TIMEOUT_MS);

      const response = await fetch("https://api.cohere.ai/v1/rerank", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: COHERE_MODEL,
          query,
          documents: docsToRank.map((c) => c.metadata.content),
          top_n: topK,
          return_documents: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "unknown");
        console.error(
          `[Rerank] Cohere API error (${response.status}): ${errorBody}`,
        );
        // Fall back to LLM rerank on API error
        return rerankWithLLM(query, chunks, topK);
      }

      const data = await response.json();

      if (!data.results || !Array.isArray(data.results)) {
        console.error(
          "[Rerank] Cohere returned unexpected response shape:",
          data,
        );
        return rerankWithLLM(query, chunks, topK);
      }

      const results: RerankResult[] = data.results
        .filter(
          (r: { index: number; relevance_score: number }) =>
            r.index >= 0 && r.index < docsToRank.length,
        )
        .map((r: { index: number; relevance_score: number }) => ({
          chunk: docsToRank[r.index],
          relevanceScore: r.relevance_score,
          index: r.index,
        }));

      console.log(
        `   🎯 [Rerank] Cohere: ${docsToRank.length} docs → top ${results.length} | topScore=${results[0]?.relevanceScore?.toFixed(3) ?? "N/A"}`,
      );

      return results;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.error(`[Rerank] Cohere timed out after ${COHERE_TIMEOUT_MS}ms`);
      } else {
        console.error("[Rerank] Cohere failed:", (error as Error).message);
      }
      // Fall back to LLM rerank
      return rerankWithLLM(query, chunks, topK);
    }
  },
  { name: "cohere-rerank", run_type: "chain" },
);

// ─── LLM Reranker (Fallback Only) ────────────────────────────────────────────

/**
 * Fallback reranker using LLM-based relevance scoring.
 * Only used when Cohere API is unavailable or fails.
 * Less accurate and ~3-5x slower than Cohere.
 */
export async function rerankWithLLM(
  query: string,
  chunks: SearchResult[],
  topK: number = 5,
  provider: ModelProvider = "groq",
): Promise<RerankResult[]> {
  if (chunks.length === 0) return [];
  if (chunks.length <= topK) {
    return chunks.map((chunk, index) => ({
      chunk,
      relevanceScore: chunk.score,
      index,
    }));
  }

  console.log(`   ⚠️ [Rerank] Using LLM fallback (Cohere unavailable)`);

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
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON found");

    const scores: { index: number; score: number }[] = JSON.parse(jsonMatch[0]);

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
    console.error("[Rerank] LLM parsing failed:", error);
    // Last resort: return top chunks by original vector score
    return chunks.slice(0, topK).map((chunk, index) => ({
      chunk,
      relevanceScore: chunk.score,
      index,
    }));
  }
}

// ─── Main Rerank Entry Point ──────────────────────────────────────────────────

/**
 * Primary rerank function.
 * Strategy: Cohere (fast, accurate) → LLM fallback (slow, less accurate)
 *
 * Cohere is always preferred when COHERE_API_KEY is set.
 * The LLM reranker is only used as a fallback.
 */
export async function rerank(
  query: string,
  chunks: SearchResult[],
  topK: number = 5,
  provider: ModelProvider = "groq",
): Promise<RerankResult[]> {
  // Always try Cohere first — it handles missing API key internally
  // and falls back to LLM rerank if needed
  if (process.env.COHERE_API_KEY) {
    return rerankWithCohere(query, chunks, topK);
  }
  return rerankWithLLM(query, chunks, topK, provider);
}
