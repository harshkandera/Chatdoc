import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { tavily } from "@tavily/core";
import { generateEmbedding } from "../embeddings";
import { searchVectorsDeduped, SearchResult } from "../pinecone";
import { rerank } from "../query/rerank";
import { decomposeQuery } from "../query/decompose";
import { shouldDecompose } from "../query/shouldDecompose";
import { generateAnswer } from "../query/generate";
import { scrapePage } from "../indexer/scrape";
import { AgentState, ScrapedPage } from "./state";

// Shared state reference (set before invoking tools)
let currentState: AgentState;

export function setToolState(state: AgentState) {
  currentState = state;
}

// 1. Classify Query Tool
export const classifyQueryTool = tool(
  async (input: { query: string }) => {
    const { decompose, reasons } = shouldDecompose(input.query);
    return JSON.stringify({
      queryType: decompose ? "complex" : "simple",
      reason: reasons[0] || "No specific reason",
    });
  },
  {
    name: "classify_query",
    description:
      "Classify if query is simple (single topic) or complex (multiple topics/comparisons)",
    schema: z.object({
      query: z.string().describe("The user query to classify"),
    }),
  },
);

// 2. Search Docs Tool
export const searchDocsTool = tool(
  async (input: { query: string; topK?: number }) => {
    const { query, topK = 20 } = input;
    const embedding = await generateEmbedding(query);
    const results = await searchVectorsDeduped(
      embedding,
      currentState.docSourceId,
      topK,
    );

    // Store in state
    currentState.searchResults = results;

    return JSON.stringify({
      count: results.length,
      topScore: results[0]?.score || 0,
      preview: results.slice(0, 3).map((r) => ({
        title: r.metadata.title,
        url: r.metadata.url,
        score: r.score.toFixed(3),
      })),
    });
  },
  {
    name: "search_docs",
    description: "Vector search in indexed documentation",
    schema: z.object({
      query: z.string().describe("Search query"),
      topK: z.number().optional().describe("Number of results (default 20)"),
    }),
  },
);

// 3. Decompose Query Tool
export const decomposeQueryTool = tool(
  async (input: { query: string }) => {
    const subQueries = await decomposeQuery(input.query, "groq");
    currentState.subQueries = subQueries;

    return JSON.stringify({
      count: subQueries.length,
      subQueries: subQueries.map((sq) => ({
        query: sq.query,
        intent: sq.intent,
      })),
    });
  },
  {
    name: "decompose_query",
    description: "Break complex query into simpler sub-queries",
    schema: z.object({
      query: z.string().describe("Complex query to decompose"),
    }),
  },
);

// 4. Rerank Results Tool
export const rerankResultsTool = tool(
  async (input: { query: string; topK?: number }) => {
    const { query, topK = 5 } = input;
    if (currentState.searchResults.length === 0) {
      return JSON.stringify({ error: "No search results to rerank" });
    }

    const reranked = await rerank(
      query,
      currentState.searchResults,
      topK,
      "groq",
    );

    const topScore = reranked[0]?.relevanceScore || 0;
    const confidence =
      topScore > 0.7 ? "high" : topScore > 0.4 ? "medium" : "low";

    // Update state
    currentState.rerankedResults = reranked.map((r) => ({
      ...r.chunk,
      score: r.relevanceScore,
    }));
    currentState.confidence = confidence;
    currentState.topScore = topScore;

    return JSON.stringify({
      confidence,
      topScore: topScore.toFixed(3),
      count: reranked.length,
      preview: reranked.slice(0, 2).map((r) => ({
        title: r.chunk.metadata.title,
        score: r.relevanceScore.toFixed(3),
      })),
    });
  },
  {
    name: "rerank_results",
    description: "Rerank search results using Cohere, returns confidence level",
    schema: z.object({
      query: z.string().describe("Original query for reranking"),
      topK: z.number().optional().describe("Number of top results (default 5)"),
    }),
  },
);

// 5. Refine Query Tool (Multi-hop)
export const refineQueryTool = tool(
  async (input: { originalQuery: string; missingInfo: string; refinedQuery: string }) => {
    const { refinedQuery } = input;
    currentState.hopCount += 1;

    // Search with refined query
    const embedding = await generateEmbedding(refinedQuery);
    const results = await searchVectorsDeduped(
      embedding,
      currentState.docSourceId,
      15,
    );

    // Merge with existing results, deduplicate
    const existingUrls = new Set(
      currentState.searchResults.map((r) => r.metadata.url),
    );
    const newResults = results.filter((r) => !existingUrls.has(r.metadata.url));
    currentState.searchResults = [...currentState.searchResults, ...newResults];

    return JSON.stringify({
      refinedQuery,
      newResultsFound: newResults.length,
      totalResults: currentState.searchResults.length,
      hopCount: currentState.hopCount,
    });
  },
  {
    name: "refine_query",
    description:
      "Create refined search query when initial results are incomplete. Use for multi-hop reasoning.",
    schema: z.object({
      originalQuery: z.string().describe("Original user query"),
      missingInfo: z.string().describe("What information is still needed"),
      refinedQuery: z.string().describe("New, more specific search query"),
    }),
  },
);

// 6. Web Search Docs Tool (Tavily Fallback)
export const webSearchDocsTool = tool(
  async (input: { query: string; siteUrl: string; maxResults?: number }) => {
    const { query, siteUrl, maxResults = 3 } = input;
    currentState.usedWebFallback = true;

    // Build site-restricted query
    const searchQuery = `site:${siteUrl} ${query}`;

    // Search with Tavily
    const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! });
    const response = await tavilyClient.search(searchQuery, {
      maxResults,
      includeRawContent: false,
    });

    // Scrape top results
    const scrapedPages: ScrapedPage[] = [];

    for (const result of response.results.slice(0, maxResults)) {
      try {
        const page = await scrapePage(result.url);
        scrapedPages.push({
          url: page.url,
          title: page.title,
          content: page.content.slice(0, 3000), // Limit content
        });
      } catch (error) {
        console.error(`Failed to scrape ${result.url}:`, error);
      }
    }

    currentState.webResults = scrapedPages;

    return JSON.stringify({
      searchQuery,
      tavilyResults: response.results.length,
      scrapedPages: scrapedPages.length,
      pages: scrapedPages.map((p) => ({
        title: p.title,
        url: p.url,
        contentLength: p.content.length,
      })),
    });
  },
  {
    name: "web_search_docs",
    description:
      "Search official docs site via Tavily and scrape results. Use as FALLBACK when vector search has low confidence.",
    schema: z.object({
      query: z.string().describe("Search query"),
      siteUrl: z
        .string()
        .describe("Documentation site domain (e.g., 'tailwindcss.com')"),
      maxResults: z
        .number()
        .optional()
        .describe("Max pages to scrape (default 3)"),
    }),
  },
);

// 7. Generate Answer Tool
export const generateAnswerTool = tool(
  async ({ includeDisclaimer = false }) => {
    // Combine vector and web results
    let chunks: SearchResult[] = currentState.rerankedResults;

    // If we have web results, convert them to SearchResult format
    if (currentState.webResults.length > 0) {
      const webChunks: SearchResult[] = currentState.webResults.map(
        (page, i) => ({
          id: `web-${i}`,
          score: 0.5,
          metadata: {
            docSourceId: currentState.docSourceId,
            content: page.content,
            url: page.url,
            urlHash: "",
            title: page.title,
            section: "",
            chunkIndex: 0,
            productName: currentState.productName,
            indexedAt: new Date().toISOString(),
          },
        }),
      );
      chunks = [...chunks, ...webChunks];
    }

    if (chunks.length === 0) {
      currentState.answer = `I couldn't find relevant information about "${currentState.query}" in the ${currentState.productName} documentation.

Try:
- Rephrasing your question
- Checking the official docs at ${currentState.docsSiteUrl}`;
      currentState.sources = [];
      currentState.finished = true;

      return JSON.stringify({ success: true, noResults: true });
    }

    const answer = await generateAnswer(currentState.query, chunks, "groq");

    let content = answer.content;
    if (includeDisclaimer) {
      content = `⚠️ **Note**: This answer is based on limited matches in the documentation.\n\n${content}`;
    }

    currentState.answer = content;
    currentState.sources = answer.sources;
    currentState.finished = true;

    return JSON.stringify({
      success: true,
      sourcesCount: answer.sources.length,
      includeDisclaimer,
    });
  },
  {
    name: "generate_answer",
    description: "Generate final answer using retrieved context",
    schema: z.object({
      includeDisclaimer: z
        .boolean()
        .optional()
        .describe("Add low-confidence disclaimer"),
    }),
  },
);

// Export all tools
export const allTools = [
  classifyQueryTool,
  searchDocsTool,
  decomposeQueryTool,
  rerankResultsTool,
  refineQueryTool,
  webSearchDocsTool,
  generateAnswerTool,
];
