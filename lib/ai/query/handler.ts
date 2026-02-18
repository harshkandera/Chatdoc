import { prisma } from "@/lib/db/prisma";
import { runQueryAgent } from "../graph";
import { ModelProvider } from "../models";
import { SearchResult } from "../pinecone";
import { shouldDecompose } from "./shouldDecompose";
import { decomposeQuery, DecomposedQuery } from "./decompose";
import { searchDocs, searchMultiple } from "./search";
import { getUserSubscription } from "@/lib/subscription";
import {
  generateAnswer,
  generateCombinedAnswer,
  buildAnswerContext,
  buildCombinedContext,
  ANSWER_SYSTEM_PROMPT_TEXT,
  GeneratedAnswer,
} from "./generate";
import { traceable } from "langsmith/traceable";

export interface SearchContextResult {
  chunks: SearchResult[];
  sources: string[];
  confidence: "high" | "medium" | "low";
  wasDecomposed: boolean;
  wasReranked: boolean;
  context: string;
  systemPrompt: string;
  queries?: DecomposedQuery[];
}

export interface QueryResult extends GeneratedAnswer {
  wasDecomposed: boolean;
  wasReranked: boolean;
  queries?: DecomposedQuery[];
  confidence: "high" | "medium" | "low";
  usedWebFallback?: boolean;
}

export interface QueryOptions {
  provider?: ModelProvider;
  modelId?: string;
  topK?: number;
}

/**
 * Search for relevant context chunks without generating an answer.
 * Used by the route handler to feed context to streamText().
 * Wrapped with traceable() so LangSmith shows this as the root RAG span.
 */
export const searchContext = traceable(
  async (
    prompt: string,
    workspaceId: string,
    options: QueryOptions = {},
  ): Promise<SearchContextResult> => {
    const handlerStart = Date.now();
    const { provider = "groq", topK = 5 } = options;

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { DocSource: true },
    });

    if (!workspace?.DocSource) {
      throw new Error("Workspace or DocSource not found");
    }

    // Step 1: Quick RAG search
    console.log(`   📋 [searchContext] Running initial RAG search...`);
    const initialSearch = await searchDocs(prompt, workspace.docSourceId, {
      topK,
      provider,
    });

    console.log(
      `   📋 [searchContext +${Date.now() - handlerStart}ms] Initial search: ${initialSearch.chunks.length} chunks, confidence=${initialSearch.confidence}`,
    );

    // Step 2: Smart decomposition decision (only if search results are poor)
    const shouldCheckDecompose =
      initialSearch.confidence === "low" || initialSearch.chunks.length < 2;

    const subscription = await getUserSubscription(workspace.userId);
    const isPro = subscription?.isActive;

    let useDecomposition = false;
    if (shouldCheckDecompose && isPro) {
      const decomposition = shouldDecompose(prompt);
      useDecomposition = decomposition.decompose;
    }

    if (!useDecomposition) {
      // Simple path — use initial search results directly
      const { context, uniqueSources } = buildAnswerContext(
        initialSearch.chunks,
      );
      return {
        chunks: initialSearch.chunks,
        sources: uniqueSources,
        confidence: initialSearch.confidence,
        wasDecomposed: false,
        wasReranked: initialSearch.wasReranked,
        context,
        systemPrompt: `${ANSWER_SYSTEM_PROMPT_TEXT}\n\nContext:\n${context}`,
      };
    }

    // Complex path — decompose and multi-search
    console.log(
      `   📋 [searchContext +${Date.now() - handlerStart}ms] Decomposing query...`,
    );
    const queries = await decomposeQuery(prompt, provider);

    const { results } = await searchMultiple(
      queries.map((q) => q.query),
      workspace.docSourceId,
      { topKPerQuery: 3, provider },
    );

    const queryResults = new Map<
      string,
      { intent: string; chunks: SearchResult[] }
    >();
    let overallConfidence: "high" | "medium" | "low" = "high";
    let anyReranked = false;
    const allChunks: SearchResult[] = [];

    for (const query of queries) {
      const result = results.get(query.query);
      if (result) {
        queryResults.set(query.query, {
          intent: query.intent,
          chunks: result.chunks,
        });
        allChunks.push(...result.chunks);
        if (result.wasReranked) anyReranked = true;
        if (query.priority === 1 && result.confidence === "low") {
          overallConfidence = "low";
        } else if (
          result.confidence === "medium" &&
          overallConfidence === "high"
        ) {
          overallConfidence = "medium";
        }
      }
    }

    const { context, uniqueSources } = buildCombinedContext(queryResults);

    return {
      chunks: allChunks,
      sources: uniqueSources,
      confidence: overallConfidence,
      wasDecomposed: true,
      wasReranked: anyReranked,
      context,
      systemPrompt: `You are a helpful documentation assistant. Answer complex questions by synthesizing information from multiple sources.

Guidelines:
- The context is organized by sub-topics that relate to the original question
- Synthesize information across all sections to provide a comprehensive answer
- Use markdown formatting for code blocks, lists, and emphasis
- Include code examples when relevant
- Reference source documents using [1], [2], etc. notation
- Structure your answer logically, addressing all aspects of the question

Context (organized by topic):

${context}`,
      queries,
    };
  },
  { name: "search-context", run_type: "chain" },
);

/**
 * Check if we should escalate to LangGraph agent.
 * Returns the agent result if escalated, null otherwise.
 * Wrapped with traceable() so escalation decisions are visible in LangSmith.
 */
export const checkEscalation = traceable(
  async (
    prompt: string,
    workspaceId: string,
    searchResult: SearchContextResult,
  ): Promise<{
    answer: string;
    sources: string[];
    confidence: "high" | "medium" | "low";
    usedWebFallback: boolean;
  } | null> => {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { DocSource: true },
    });

    if (!workspace?.DocSource) return null;

    const subscription = await getUserSubscription(workspace.userId);
    const isPro = subscription?.isActive;
    const canUseLangGraph = isPro && !!process.env.TAVILY_API_KEY;

    if (searchResult.confidence !== "low" || !canUseLangGraph) return null;
    if (searchResult.chunks.length >= 2) return null;

    console.log(
      `   🔄 [handler] RAG confidence LOW + few chunks → escalating to LangGraph agent...`,
    );

    try {
      const agentResult = await runQueryAgent(
        prompt,
        workspace.docSourceId,
        workspace.DocSource.rootUrl,
        workspace.DocSource.productName,
      );

      return {
        answer: agentResult.answer,
        sources: agentResult.sources,
        confidence: agentResult.confidence as "high" | "medium" | "low",
        usedWebFallback: agentResult.usedWebFallback,
      };
    } catch (error) {
      console.error(`   ❌ [handler] LangGraph agent error:`, error);
      return null;
    }
  },
  { name: "check-escalation", run_type: "chain" },
);

/**
 * Full query handler (non-streaming). Used by non-streaming paths.
 */
export async function handleQuery(
  prompt: string,
  workspaceId: string,
  options: QueryOptions = {},
): Promise<QueryResult> {
  const { provider = "groq", modelId } = options;

  const search = await searchContext(prompt, workspaceId, options);

  // Check escalation
  const escalation = await checkEscalation(prompt, workspaceId, search);
  if (escalation) {
    return {
      content: escalation.answer,
      sources: escalation.sources,
      references: escalation.sources.map((url, i) => ({
        index: i + 1,
        url,
        title: url.split("/").pop() || "Reference",
      })),
      wasDecomposed: false,
      wasReranked: true,
      confidence: escalation.confidence,
      usedWebFallback: escalation.usedWebFallback,
    };
  }

  // Generate answer using non-streaming path
  let answer: GeneratedAnswer;
  if (search.wasDecomposed && search.queries) {
    const queryResults = new Map<
      string,
      { intent: string; chunks: SearchResult[] }
    >();
    // Rebuild queryResults from search chunks
    for (const q of search.queries) {
      queryResults.set(q.query, {
        intent: q.intent,
        chunks: search.chunks.filter(
          (c) => c.metadata.url, // include all chunks
        ),
      });
    }
    answer = await generateCombinedAnswer(
      prompt,
      queryResults,
      provider,
      modelId,
    );
  } else {
    answer = await generateAnswer(prompt, search.chunks, provider, modelId);
  }

  return {
    ...answer,
    wasDecomposed: search.wasDecomposed,
    wasReranked: search.wasReranked,
    confidence: search.confidence,
  };
}

export { searchDocs, generateAnswer };
