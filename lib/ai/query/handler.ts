import { prisma } from "@/lib/db/prisma";
import { runQueryAgent } from "../graph";
import { ModelProvider } from "../models";
import { SearchResult } from "../pinecone";
import { shouldDecompose } from "./shouldDecompose";
import { decomposeQuery, DecomposedQuery } from "./decompose";
import { graphAugmentedSearch, searchDocs, searchMultiple } from "./search";
import { getUserSubscription } from "@/lib/subscription";
import {
  generateAnswer,
  generateCombinedAnswer,
  buildAnswerContext,
  buildCombinedContext,
  buildAnswerSystemPrompt,
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
  /** Per-query results (only set when wasDecomposed=true) */
  queryResults?: Map<string, { intent: string; chunks: SearchResult[] }>;
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

    // Step 1: Graph-augmented RAG search (falls back to pure vector when Neo4j is off)
    console.log(`   📋 [searchContext] Running graph-augmented RAG search...`);
    const initialSearch = await graphAugmentedSearch(
      prompt,
      workspace.docSourceId,
      { topK, provider },
    );

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
        systemPrompt: `${buildAnswerSystemPrompt(workspace.DocSource.productName)}\n\nContext:\n${context}`,
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
      queryResults,
      systemPrompt: `You are a helpful documentation assistant for ${workspace.DocSource.productName}. Answer complex questions by synthesizing information from multiple sources.

Guidelines:
- The context is organized by sub-topics that relate to the original question
- Synthesize information across all sections to provide a comprehensive answer
- Use markdown formatting for code blocks, lists, and emphasis
- Include code examples when relevant
- If the user asks a completely unrelated general programming question (e.g., 'write a C++ algorithm'), politely decline and state that you can only answer questions related to the provided documentation.
- However, if the question is about integrating the documented tool with another technology (e.g., 'how to install next js', 'how to use with React'), you MUST use your general knowledge to assist them. Always assume the user means "in the context of this tool" if they name a popular framework.
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
 * Only Pro users with TAVILY_API_KEY can use the agent.
 * Wrapped with traceable() so escalation decisions are visible in LangSmith.
 */
export const checkEscalation = traceable(
  async (
    prompt: string,
    workspaceId: string,
    searchResult: SearchContextResult,
    isPro: boolean,
    /** Pass workspace to avoid redundant DB query */
    workspace?: {
      docSourceId: string;
      DocSource: { rootUrl: string; productName: string };
    },
    chatHistory: { role: string; content: string }[] = [],
    chatSummary: string = "",
  ): Promise<{
    answer: string;
    sources: string[];
    confidence: "high" | "medium" | "low";
    usedWebFallback: boolean;
  } | null> => {
    if (!isPro) {
      console.log(`   ⏭️ [checkEscalation] Skipped: user is not Pro`);
      return null;
    }
    if (!process.env.TAVILY_API_KEY && !process.env.SEARXNG_URL) {
      console.log(
        `   ⏭️ [checkEscalation] Skipped: no search provider configured`,
      );
      return null;
    }

    // Always escalate to agent — the gradeNode inside the agent uses the LLM
    // grader to decide sufficiency. High-score cases fast-bypass the grader
    // and go straight to generate without an extra LLM call.
    console.log(
      `   🔄 [checkEscalation] Escalating to agent (grader will decide) — confidence=${searchResult.confidence}, topScore=${(searchResult.chunks[0]?.score ?? 0).toFixed(3)}, chunks=${searchResult.chunks.length}`,
    );

    // Use passed workspace or fetch if not provided
    let ws = workspace;
    if (!ws) {
      const fetched = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: { DocSource: true },
      });
      if (!fetched?.DocSource) {
        console.log(
          `   ⏭️ [checkEscalation] Skipped: workspace or DocSource not found`,
        );
        return null;
      }
      ws = { docSourceId: fetched.docSourceId, DocSource: fetched.DocSource };
    }

    console.log(
      `   🔄 [handler] LLM grader: context insufficient + Pro user → escalating to LangGraph agent...`,
    );

    try {
      const agentResult = await runQueryAgent(
        prompt,
        ws.docSourceId,
        ws.DocSource.rootUrl,
        ws.DocSource.productName,
        true,
        undefined, // onStream
        chatHistory,
        chatSummary,
        searchResult.chunks, // preloadedResults — already Cohere-reranked, skip retrieve+rerank
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

  // Fetch workspace once and reuse everywhere
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { DocSource: true },
  });
  if (!workspace?.DocSource) {
    throw new Error("Workspace or DocSource not found");
  }

  const search = await searchContext(prompt, workspaceId, options);

  const subscription = await getUserSubscription(workspace.userId);
  const isPro = subscription?.isActive ?? false;

  const escalation = await checkEscalation(prompt, workspaceId, search, isPro, {
    docSourceId: workspace.docSourceId,
    DocSource: workspace.DocSource,
  });
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
  const pName = workspace.DocSource.productName;
  let answer: GeneratedAnswer;

  if (search.wasDecomposed && search.queryResults) {
    // Reuse per-query results from searchContext (avoids double searchMultiple)
    answer = await generateCombinedAnswer(
      prompt,
      search.queryResults,
      pName,
      provider,
      modelId,
    );
  } else {
    answer = await generateAnswer(
      prompt,
      search.chunks,
      pName,
      provider,
      modelId,
    );
  }

  return {
    ...answer,
    wasDecomposed: search.wasDecomposed,
    wasReranked: search.wasReranked,
    confidence: search.confidence,
  };
}

export { searchDocs, generateAnswer };
