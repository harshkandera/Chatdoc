import { generateEmbedding } from "../embeddings";
import { ModelProvider } from "../models";
import { searchVectorsDeduped, SearchResult } from "../pinecone";
import { rerank, RerankResult } from "./rerank";
import { classifyConfidence } from "../constants";
import { traceable } from "langsmith/traceable";

export interface SearchOptions {
  topK?: number;
  provider?: ModelProvider;
}

export interface SearchOutput {
  chunks: SearchResult[];
  wasReranked: boolean;
  confidence: "high" | "medium" | "low";
}

/**
 * Search documentation with optional reranking.
 * Wrapped with traceable() so each vector search is a named span in LangSmith.
 */
export const searchDocs = traceable(
  async (
    query: string,
    docSourceId: string,
    options: SearchOptions = {},
  ): Promise<SearchOutput> => {
    const { topK = 5, provider = "groq" } = options;

    if (!docSourceId) {
      return {
        chunks: [],
        wasReranked: false,
        confidence: "low",
      };
    }

    const embedding = await generateEmbedding(query);

    // Always overfetch so we can rerank if needed
    const searchTopK = topK * 3;
    const results = await searchVectorsDeduped(
      embedding,
      docSourceId,
      searchTopK,
    );

    if (results.length === 0) {
      return {
        chunks: [],
        wasReranked: false,
        confidence: "low",
      };
    }

    const rawTopScore = results[0]?.score || 0;
    const rawConfidence = classifyConfidence(rawTopScore);

    let finalChunks: SearchResult[];
    let wasReranked = false;
    let topScore: number;

    // Smart reranking: only when medium confidence AND enough candidates
    if (rawConfidence === "medium" && results.length > topK) {
      const reranked = await rerank(query, results, topK, provider);
      finalChunks = reranked.map((r: RerankResult) => ({
        ...r.chunk,
        score: r.relevanceScore,
      }));
      wasReranked = true;
      topScore = reranked[0]?.relevanceScore || 0;
    } else {
      finalChunks = results.slice(0, topK);
      topScore = rawTopScore;
    }

    const confidence = classifyConfidence(topScore);

    return {
      chunks: finalChunks,
      wasReranked,
      confidence,
    };
  },
  { name: "search-docs", run_type: "retriever" },
);

export interface MultiSearchOptions {
  topKPerQuery?: number;
  provider?: ModelProvider;
}

export interface MultiSearchOutput {
  results: Map<string, SearchOutput>;
  allChunks: SearchResult[];
}

/**
 * Search for multiple queries and combine results.
 * Wrapped with traceable() so multi-query searches appear as a grouped span.
 */
export const searchMultiple = traceable(
  async (
    queries: string[],
    docSourceId: string,
    options: MultiSearchOptions = {},
  ): Promise<MultiSearchOutput> => {
    const { topKPerQuery = 3, provider = "groq" } = options;

    const resultsMap = new Map<string, SearchOutput>();
    const allChunks: SearchResult[] = [];
    const seenUrls = new Set<string>();

    const searchPromises = queries.map(async (query) => {
      const result = await searchDocs(query, docSourceId, {
        topK: topKPerQuery,
        provider,
      });
      return { query, result };
    });

    const searchResults = await Promise.all(searchPromises);

    // Collect and deduplicate results
    for (const { query, result } of searchResults) {
      resultsMap.set(query, result);

      for (const chunk of result.chunks) {
        if (!seenUrls.has(chunk.metadata.url)) {
          seenUrls.add(chunk.metadata.url);
          allChunks.push(chunk);
        }
      }
    }

    return {
      results: resultsMap,
      allChunks,
    };
  },
  { name: "search-multiple", run_type: "retriever" },
);
