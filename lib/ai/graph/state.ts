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
  messages: BaseMessage[];

  // Classification
  queryType?: "simple" | "complex";
  subQueries?: { query: string; intent: string }[];

  // Search results
  searchResults: SearchResult[];
  rerankedResults: SearchResult[];
  webResults: ScrapedPage[];

  // Confidence & routing
  confidence: "high" | "medium" | "low";
  topScore: number;
  hopCount: number;
  usedWebFallback: boolean;

  // Output
  answer?: string;
  sources: string[];
  finished: boolean;
}

// Initial state factory
export function createInitialState(
  query: string,
  docSourceId: string,
  docsSiteUrl: string,
  productName: string,
): Partial<AgentState> {
  return {
    query,
    docSourceId,
    docsSiteUrl,
    productName,
    messages: [],
    searchResults: [],
    rerankedResults: [],
    webResults: [],
    confidence: "low",
    topScore: 0,
    hopCount: 0,
    usedWebFallback: false,
    sources: [],
    finished: false,
  };
}
