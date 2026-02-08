import { generateEmbedding } from "../embeddings";
import { ModelProvider } from "../models";
import { searchVectorsDeduped, SearchResult } from "../pinecone";
import { rerank, RerankResult } from "./rerank";
import { prisma } from "@/lib/db/prisma";

export interface SearchOptions {
  topK?: number;
  useReranker?: boolean;
  provider?: ModelProvider;
}

export interface SearchOutput {
  chunks: SearchResult[];
  wasReranked: boolean;
  confidence: "high" | "medium" | "low";
}

/**
 * Search documentation with optional reranking
 */
export async function searchDocs(
  query: string,
  workspaceId: string,
  options: SearchOptions = {},
): Promise<SearchOutput> {
  const { topK = 5, useReranker = true, provider = "groq" } = options;

  // Get workspace to find docSourceId
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { docSourceId: true },
  });

  if (!workspace?.docSourceId) {
    return {
      chunks: [],
      wasReranked: false,
      confidence: "low",
    };
  }

  // Generate embedding for query
  const embedding = await generateEmbedding(query);

  // Search with more results if we're going to rerank
  const searchTopK = useReranker ? topK * 4 : topK;
  const results = await searchVectorsDeduped(
    embedding,
    workspace.docSourceId,
    searchTopK,
  );

  if (results.length === 0) {
    return {
      chunks: [],
      wasReranked: false,
      confidence: "low",
    };
  }

  let finalChunks: SearchResult[];
  let wasReranked = false;
  let topScore: number;

  if (useReranker && results.length > topK) {
    // Rerank results
    const reranked = await rerank(query, results, topK, provider);
    finalChunks = reranked.map((r: RerankResult) => ({
      ...r.chunk,
      score: r.relevanceScore,
    }));
    wasReranked = true;
    topScore = reranked[0]?.relevanceScore || 0;
  } else {
    // Use raw search results
    finalChunks = results.slice(0, topK);
    topScore = results[0]?.score || 0;
  }

  // Determine confidence based on top score
  const confidence: "high" | "medium" | "low" =
    topScore > 0.7 ? "high" : topScore > 0.4 ? "medium" : "low";

  return {
    chunks: finalChunks,
    wasReranked,
    confidence,
  };
}

export interface MultiSearchOptions {
  topKPerQuery?: number;
  useReranker?: boolean;
  provider?: ModelProvider;
}

export interface MultiSearchOutput {
  results: Map<string, SearchOutput>;
  allChunks: SearchResult[];
}

/**
 * Search for multiple queries and combine results
 */
export async function searchMultiple(
  queries: string[],
  workspaceId: string,
  options: MultiSearchOptions = {},
): Promise<MultiSearchOutput> {
  const { topKPerQuery = 3, useReranker = true, provider = "groq" } = options;

  const resultsMap = new Map<string, SearchOutput>();
  const allChunks: SearchResult[] = [];
  const seenUrls = new Set<string>();

  // Search for each query in parallel
  const searchPromises = queries.map(async (query) => {
    const result = await searchDocs(query, workspaceId, {
      topK: topKPerQuery,
      useReranker,
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
}
