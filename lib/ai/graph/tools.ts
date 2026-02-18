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
import { ScrapedPage } from "./state";
import { classifyConfidence } from "../constants";

// ─── 1. CORE FUNCTIONS (Called by Graph Nodes directly) ───

export async function searchDocsFunction(
  query: string,
  docSourceId: string,
  topK: number = 20,
) {
  const embedding = await generateEmbedding(query);
  const results = await searchVectorsDeduped(embedding, docSourceId, topK);
  return results;
}

export async function rerankDocsFunction(
  query: string,
  searchResults: SearchResult[],
  topK: number = 5,
) {
  if (searchResults.length === 0) {
    return { reranked: [], confidence: "low" as const, topScore: 0 };
  }

  const reranked = await rerank(query, searchResults, topK, "groq");
  const topScore = reranked[0]?.relevanceScore || 0;
  const confidence = classifyConfidence(topScore);

  const rerankedResults = reranked.map((r) => ({
    ...r.chunk,
    score: r.relevanceScore,
  }));

  return {
    reranked: rerankedResults,
    confidence,
    topScore,
  };
}

export async function generateAnswerFunction(
  query: string,
  results: SearchResult[],
  productName: string,
  includeDisclaimer: boolean = false,
) {
  if (results.length === 0) {
    return {
      answer: `I couldn't find relevant information about "${query}" in the ${productName} documentation.`,
      sources: [],
    };
  }

  const generated = await generateAnswer(query, results, "groq");
  let content = generated.content;

  if (includeDisclaimer) {
    content = `⚠️ **Note**: This answer is based on limited matches in the documentation.\n\n${content}`;
  }

  return {
    answer: content,
    sources: generated.sources,
  };
}

// ─── 2. AGENT TOOLS (Called by LLM in Slow Path) ───

// Classify Query Tool
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

// Decompose Query Tool
export const decomposeQueryTool = tool(
  async (input: { query: string }) => {
    const subQueries = await decomposeQuery(input.query, "groq");
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

// Web Search Tool (Tavily)
// NOTE: We need to pass state explicitly or use a closure if we want to access docsSiteUrl
// Since tools are static, we'll require the URL to be passed in the input OR use a hack.
// BETTER: The AgentNode in LangGraph can inject these values into the tool input or we bind them.
// For now, let's assume the LLM will be told the URL in the system prompt, OR we bind it at runtime.
// Actually, LangGraph tools can't easily access graph state dynamically without binding.
// We will bind 'docsSiteUrl' and 'productName' and 'docSourceId' when creating the toolNode in agent.ts.
export const webSearchDocsTool = tool(
  async (input: { query: string }, config) => {
    // defaults from config or fallback
    const docsSiteUrl = config.configurable?.docsSiteUrl;
    const docSourceId = config.configurable?.docSourceId;
    const productName = config.configurable?.productName;

    if (!docsSiteUrl || !docSourceId) {
      return JSON.stringify({
        error: "Configuration Error: docsSiteUrl or docSourceId missing",
      });
    }

    const searchQuery = `site:${docsSiteUrl} ${input.query}`;

    // Search with Tavily
    const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! });
    const response = await tavilyClient.search(searchQuery, {
      maxResults: 3,
      includeRawContent: false,
    });

    // Scrape top results
    const scrapedPages: ScrapedPage[] = [];

    for (const result of response.results.slice(0, 3)) {
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

    // Fire Inngest job (non-blocking) - fire and forget
    if (scrapedPages.length > 0) {
      import("@/lib/inngest/client")
        .then(({ inngest }) =>
          inngest.send({
            name: "docsource/pages.discovered",
            data: {
              docSourceId,
              productName,
              pages: scrapedPages.map((p) => ({
                url: p.url,
                title: p.title,
                content: p.content,
              })),
            },
          }),
        )
        .catch((err) =>
          console.error("[web_search] Failed to queue indexing:", err),
        );
    }

    // Return the pages directly so the agent node can update state
    // The ToolNode in LangGraph will capture this return value.
    // However, since we are doing custom node logic often, we can returns a JSON
    // that our custom tool node parsers.
    // Standard ToolNode just puts this string into ToolMessage.content.
    return JSON.stringify({
      scrapedPages, // The agent will need to parse this to update state.webResults
    });
  },
  {
    name: "web_search_docs",
    description: "Search and scrape the product's official docs site.",
    schema: z.object({
      query: z.string().describe("Search query"),
    }),
  },
);

export const agentTools = [
  classifyQueryTool,
  decomposeQueryTool,
  webSearchDocsTool,
];
