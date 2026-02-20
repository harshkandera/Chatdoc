import { BaseMessage } from "@langchain/core/messages";
import { SearchResult } from "../pinecone";

// Scraped page from web search
export interface ScrapedPage {
  url: string;
  title: string;
  content: string;
}

// Agent state for query processing
export interface AgentState {
  // Input
  query: string;
  docSourceId: string;
  docsSiteUrl: string;
  productName: string;
  isPro: boolean;
  messages: BaseMessage[];

  // Classification
  queryType?: "simple" | "complex";
  subQueries?: { query: string; intent: string }[];

  // Search results
  searchResults: SearchResult[];
  rerankedResults: SearchResult[];
  webResults: ScrapedPage[];

  // Confidence (telemetry only — NOT used for routing)
  confidence: "high" | "medium" | "low";
  topScore: number;

  // Routing (authoritative — set by LLM context grader)
  isContextSufficient: boolean;

  // Control flow
  hopCount: number;
  usedWebFallback: boolean;

  // Output
  answer?: string;
  sources: string[];
  finished: boolean;

  // Error tracking — concat reducer accumulates errors from all nodes
  errors: string[];
}

// Initial state factory
export function createInitialState(
  query: string,
  docSourceId: string,
  docsSiteUrl: string,
  productName: string,
  isPro: boolean,
): Partial<AgentState> {
  return {
    query,
    docSourceId,
    docsSiteUrl,
    productName,
    isPro,
    messages: [],
    searchResults: [],
    rerankedResults: [],
    webResults: [],
    confidence: "low",
    topScore: 0,
    isContextSufficient: false,
    hopCount: 0,
    usedWebFallback: false,
    sources: [],
    finished: false,
    errors: [],
  };
}
