import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { tavily } from "@tavily/core";
import { SearchResult } from "../pinecone";
import { rerank } from "../query/rerank";
import { generateAnswer } from "../query/generate";
import { scrapePage } from "../indexer/scrape";
import { ScrapedPage } from "./state";
import { classifyConfidence } from "../constants";
import { isNeo4jEnabled, runCypher } from "./neo4j";
import { extractQueryEntities } from "../query/search";

// ─── 1. CORE FUNCTIONS (Called by Graph Nodes directly) ───

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

  const generated = await generateAnswer(query, results, productName, "groq");
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

// ─── Search helpers ───

async function searchWithSearXNG(
  query: string,
  maxResults: number = 3,
): Promise<string[]> {
  const searxngUrl = process.env.SEARXNG_URL;
  if (!searxngUrl) throw new Error("SEARXNG_URL not set");

  const url = `${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`SearXNG returned ${res.status}`);

  const data = await res.json();
  return (data.results as { url: string }[])
    .slice(0, maxResults)
    .map((r) => r.url);
}

async function searchWithTavily(
  query: string,
  maxResults: number = 3,
): Promise<string[]> {
  const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! });
  const response = await tavilyClient.search(query, {
    maxResults,
    includeRawContent: false,
  });
  return response.results.map((r) => r.url);
}

async function getSearchUrls(
  query: string,
  maxResults: number = 3,
): Promise<string[]> {
  // Try SearXNG first, fall back to Tavily
  if (process.env.SEARXNG_URL) {
    try {
      const urls = await searchWithSearXNG(query, maxResults);
      if (urls.length > 0) {
        console.log(`[web_search] SearXNG returned ${urls.length} URLs`);
        return urls;
      }
      console.warn("[web_search] SearXNG returned 0 results, falling back to Tavily");
    } catch (err) {
      console.warn(`[web_search] SearXNG failed (${(err as Error).message}), falling back to Tavily`);
    }
  }

  if (!process.env.TAVILY_API_KEY) {
    throw new Error("No search provider available (SEARXNG_URL and TAVILY_API_KEY both missing)");
  }

  const urls = await searchWithTavily(query, maxResults);
  console.log(`[web_search] Tavily fallback returned ${urls.length} URLs`);
  return urls;
}

// Web Search Tool (SearXNG primary, Tavily fallback)
export const webSearchDocsTool = tool(
  async (input: { query: string }, config) => {
    const docsSiteUrl = config.configurable?.docsSiteUrl;
    const docSourceId = config.configurable?.docSourceId;
    const productName = config.configurable?.productName;

    if (!docsSiteUrl || !docSourceId) {
      return JSON.stringify({
        error: "Configuration Error: docsSiteUrl or docSourceId missing",
      });
    }

    const searchQuery = `site:${docsSiteUrl} ${input.query}`;

    // Get URLs (SearXNG → Tavily fallback)
    let urls: string[];
    try {
      urls = await getSearchUrls(searchQuery, 3);
    } catch (err) {
      console.error("[web_search] All search providers failed:", err);
      return JSON.stringify({ scrapedPages: [] });
    }

    // Scrape all URLs in parallel
    const scrapedPages: ScrapedPage[] = (
      await Promise.all(
        urls.map(async (url) => {
          try {
            const page = await scrapePage(url);
            return {
              url: page.url,
              title: page.title,
              content: page.content.slice(0, 3000),
            } as ScrapedPage;
          } catch (error) {
            console.error(`Failed to scrape ${url}:`, error);
            return null;
          }
        }),
      )
    ).filter((p): p is ScrapedPage => p !== null);

    // Await the Inngest event so it is guaranteed to be sent before the serverless function returns (#21 fix)
    // Fire-and-forget (.then().catch()) risks the function recycling before the event is dispatched.
    if (scrapedPages.length > 0) {
      try {
        const { inngest } = await import("@/lib/inngest/client");
        await inngest.send({
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
        });
      } catch (err) {
        console.error("[web_search] Failed to queue indexing:", err);
      }
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

// Knowledge Graph Search Tool
// Queries Neo4j for entities related to the search query.
// Silently returns an empty result when Neo4j is not configured.
export const graphSearchTool = tool(
  async (
    input: { query: string; mode: "neighbors" | "prerequisites" | "errors" },
    config,
  ) => {
    const docSourceId = config?.configurable?.docSourceId as
      | string
      | undefined;

    if (!docSourceId || !isNeo4jEnabled()) {
      return JSON.stringify({ available: false, relatedPages: [] });
    }

    const entityNames = await extractQueryEntities(input.query);
    if (entityNames.length === 0) {
      return JSON.stringify({ available: true, entities: [], relatedPages: [] });
    }

    let cypher: string;

    if (input.mode === "prerequisites") {
      cypher = `
        MATCH (e:Entity {docSourceId: $docSourceId})
        WHERE e.name IN $names
        MATCH (prereq:Entity)-[:RELATED_TO {type: 'prerequisite'}]->(e)
        MATCH (prereq)-[:MENTIONED_IN]->(p:Page)
        RETURN prereq.name AS entity, p.url AS url, p.title AS title
        LIMIT 8`;
    } else if (input.mode === "errors") {
      cypher = `
        MATCH (e:Entity {docSourceId: $docSourceId})
        WHERE e.name IN $names
        MATCH (e)-[:RELATED_TO]->(err:Entity {type: 'error'})
        MATCH (err)-[:MENTIONED_IN]->(p:Page)
        RETURN err.name AS entity, p.url AS url, p.title AS title
        LIMIT 8`;
    } else {
      // neighbors (default)
      cypher = `
        MATCH (e:Entity {docSourceId: $docSourceId})
        WHERE e.name IN $names
        MATCH (e)-[:RELATED_TO*1..2]->(neighbor:Entity)
        MATCH (neighbor)-[:MENTIONED_IN]->(p:Page)
        RETURN DISTINCT neighbor.name AS entity, p.url AS url, p.title AS title
        LIMIT 8`;
    }

    try {
      const results = await runCypher<{
        entity: string;
        url: string;
        title: string;
      }>(cypher, { docSourceId, names: entityNames });

      return JSON.stringify({
        available: true,
        entities: entityNames,
        relatedPages: results,
      });
    } catch (err) {
      console.error("[graphSearchTool] Cypher error:", err);
      return JSON.stringify({ available: false, relatedPages: [] });
    }
  },
  {
    name: "graph_search",
    description:
      "Search the knowledge graph for entities related to the query. Use mode='neighbors' to find related concepts, 'prerequisites' for required prior knowledge, 'errors' to find error-handling pages.",
    schema: z.object({
      query: z.string().describe("The search query"),
      mode: z
        .enum(["neighbors", "prerequisites", "errors"])
        .describe("Graph traversal mode"),
    }),
  },
);

// graphSearchTool is intentionally NOT included here.
// KG enrichment happens automatically inside retrieveWithKg (vector + KG boost + rerank),
// which runs before the agent is ever called. The agent only handles web fallback.
export const agentTools = [webSearchDocsTool];
