import { generateEmbedding } from "../embeddings";
import { invokeModel, ModelProvider } from "../models";
import { searchVectorsDeduped, SearchResult } from "../pinecone";
import { rerank, RerankResult } from "./rerank";
import { classifyConfidence } from "../constants";
import { traceable } from "langsmith/traceable";
import { isNeo4jEnabled, runCypher } from "../graph/neo4j";

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

    // searchVectorsDeduped already overfetches 3× internally for dedup
    const results = await searchVectorsDeduped(
      embedding,
      docSourceId,
      topK,
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

// ─── KG-Augmented Search ──────────────────────────────────────────────────────

/**
 * Extract specific named entities (functions, configs, errors, concepts) from
 * a query string using a fast LLM call. Used to look up the knowledge graph.
 * Returns [] when Neo4j is disabled or the LLM returns nothing useful.
 */
export async function extractQueryEntities(query: string): Promise<string[]> {
  if (!isNeo4jEnabled()) return [];

  try {
    const smallProvider = (process.env.SMALL_MODEL_PROVIDER || "groq") as ModelProvider;
    const response = await invokeModel(smallProvider, [
      {
        role: "system",
        content: `Extract named technical entities from a documentation query.
Return a JSON array of strings — include: API methods, hooks, components, config keys, error types, AND named concepts/features (e.g. "App Router", "Server Components", "middleware").
Do NOT include generic filler words like "how", "use", "install", "what", "is", "the", "a".
Return at most 5 entities. Examples:
  - "how does App Router work" → ["App Router"]
  - "useState hook tutorial" → ["useState"]
  - "configure package.json for next.js" → ["package.json", "Next.js"]
  - "Server Components vs Client Components" → ["Server Components", "Client Components"]
Return [] only if there are truly no named entities.`,
      },
      {
        role: "user",
        content: `Query: ${query}\n\nReturn JSON array:`,
      },
    ]);

    const match = response.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? (parsed as string[]).slice(0, 5) : [];
  } catch {
    return [];
  }
}

/**
 * Look up entities in Neo4j and return URLs of pages that mention them
 * or are reachable within 2 hops via RELATED_TO edges.
 */
async function findKgPages(
  entityNames: string[],
  docSourceId: string,
): Promise<Set<string>> {
  if (entityNames.length === 0) return new Set();

  try {
    const records = await runCypher<{ url: string }>(
      `MATCH (e:Entity {docSourceId: $docSourceId})
       WHERE e.name IN $names
       MATCH (e)-[:MENTIONED_IN]->(p:Page)
       RETURN DISTINCT p.url AS url
       UNION
       MATCH (e:Entity {docSourceId: $docSourceId})
       WHERE e.name IN $names
       MATCH (e)-[:RELATED_TO*1..2]->(e2:Entity)-[:MENTIONED_IN]->(p:Page)
       RETURN DISTINCT p.url AS url
       LIMIT 15`,
      { docSourceId, names: entityNames },
    );
    return new Set(records.map((r) => r.url));
  } catch (err) {
    console.warn("[KG] Neo4j page lookup failed, skipping graph boost:", err);
    return new Set();
  }
}

/**
 * Boost chunks whose URL matches a KG-identified page.
 * Score is multiplied by 1.25 (capped at 1.0) so KG pages surface first.
 */
function applyKgBoost(
  results: SearchResult[],
  kgUrls: Set<string>,
): SearchResult[] {
  if (kgUrls.size === 0) return results;

  return results
    .map((r) =>
      kgUrls.has(r.metadata.url)
        ? { ...r, score: Math.min(1, r.score * 1.25) }
        : r,
    )
    .sort((a, b) => b.score - a.score);
}

/**
 * Drop-in replacement for searchDocs that also queries the Neo4j knowledge graph.
 * When Neo4j is disabled the function behaves identically to searchDocs.
 *
 * Flow:
 *  1. Vector search (overfetch 4× topK) + KG entity lookup — in parallel
 *  2. Boost vector results whose page was found in the KG
 *  3. Optional rerank (same heuristic as searchDocs)
 */
export const graphAugmentedSearch = traceable(
  async (
    query: string,
    docSourceId: string,
    options: SearchOptions = {},
  ): Promise<SearchOutput> => {
    const { topK = 5, provider = "groq" } = options;

    if (!docSourceId) {
      return { chunks: [], wasReranked: false, confidence: "low" };
    }

    // Run vector search and KG entity extraction concurrently
    // Pass topK directly — searchVectorsDeduped already overfetches 3× internally
    const [rawResults, entityNames] = await Promise.all([
      (async () => {
        const embedding = await generateEmbedding(query);
        return searchVectorsDeduped(embedding, docSourceId, topK);
      })(),
      extractQueryEntities(query),
    ]);

    if (rawResults.length === 0) {
      return { chunks: [], wasReranked: false, confidence: "low" };
    }

    // KG page lookup (parallel-friendly — already extracted entities above)
    const kgUrls = await findKgPages(entityNames, docSourceId);

    console.log(
      `   🕸️  [KG] entities=${JSON.stringify(entityNames)} kg_pages=${kgUrls.size} vector_results=${rawResults.length}`,
    );

    // Apply KG boost then take candidates for reranking
    const candidates = applyKgBoost(rawResults, kgUrls);
    const boostedCount = candidates.filter((c) => kgUrls.has(c.metadata.url)).length;
    if (boostedCount > 0) {
      console.log(`   🕸️  [KG] boosted ${boostedCount} chunks from KG pages`);
    }

    const rawTopScore = candidates[0]?.score || 0;
    const rawConfidence = classifyConfidence(rawTopScore);

    // Smart reranking: only when medium confidence and enough candidates
    if (rawConfidence === "medium" && candidates.length > topK) {
      const reranked = await rerank(query, candidates, topK, provider);
      const finalChunks = reranked.map((r: RerankResult) => ({
        ...r.chunk,
        score: r.relevanceScore,
      }));
      return {
        chunks: finalChunks,
        wasReranked: true,
        confidence: classifyConfidence(reranked[0]?.relevanceScore || 0),
      };
    }

    return {
      chunks: candidates.slice(0, topK),
      wasReranked: false,
      confidence: classifyConfidence(rawTopScore),
    };
  },
  { name: "graph-augmented-search", run_type: "retriever" },
);

/**
 * Vector search + KG boost for the agent graph, WITHOUT reranking.
 * The agent graph has its own smart rerankNode that decides whether to rerank.
 * Overfetches `topK` results from Pinecone, then re-ranks their order by KG boost.
 */
export async function retrieveWithKg(
  query: string,
  docSourceId: string,
  topK: number = 20,
): Promise<{ results: SearchResult[]; topScore: number; kgPageCount: number; kgEntityCount: number }> {
  if (!docSourceId) {
    return { results: [], topScore: 0, kgPageCount: 0, kgEntityCount: 0 };
  }

  // Vector search and entity extraction in parallel
  const [rawResults, entityNames] = await Promise.all([
    (async () => {
      const embedding = await generateEmbedding(query);
      return searchVectorsDeduped(embedding, docSourceId, topK);
    })(),
    extractQueryEntities(query),
  ]);

  if (rawResults.length === 0) {
    return { results: [], topScore: 0, kgPageCount: 0, kgEntityCount: entityNames.length };
  }

  // KG page lookup (only runs if Neo4j configured and entities were found)
  const kgUrls = await findKgPages(entityNames, docSourceId);
  const boosted = applyKgBoost(rawResults, kgUrls);
  const kgPageCount = boosted.filter((r) => kgUrls.has(r.metadata.url)).length;

  if (kgPageCount > 0) {
    console.log(
      `   🕸️  [KG] entities=${JSON.stringify(entityNames)} kg_pages=${kgUrls.size} boosted=${kgPageCount}/${boosted.length}`,
    );
  }

  return {
    results: boosted,
    topScore: boosted[0]?.score || 0,
    kgPageCount,
    kgEntityCount: entityNames.length,
  };
}

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
