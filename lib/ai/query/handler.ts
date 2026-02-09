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
  GeneratedAnswer,
} from "./generate";

export interface QueryResult extends GeneratedAnswer {
  wasDecomposed: boolean;
  wasReranked: boolean;
  queries?: DecomposedQuery[];
  confidence: "high" | "medium" | "low";
  usedWebFallback?: boolean;
}

export interface QueryOptions {
  provider?: ModelProvider;
  useReranker?: boolean;
  topK?: number;
  useLangGraph?: boolean;
}

// Main query handler - now supports LangGraph agent
export async function handleQuery(
  prompt: string,
  workspaceId: string,
  options: QueryOptions = {},
): Promise<QueryResult> {
  const handlerStart = Date.now();
  console.log(`   📋 [handler] Starting query handler...`);

  const {
    provider = "groq",
    useReranker = true,
    topK = 5,
    useLangGraph = false, // Disabled - docs need to be indexed first
  } = options;

  // Get workspace with DocSource for LangGraph
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { DocSource: true },
  });
  console.log(
    `   📋 [handler +${Date.now() - handlerStart}ms] Workspace fetched`,
  );

  if (!workspace?.DocSource) {
    throw new Error("Workspace or DocSource not found");
  }

  // Check subscription for Deep Research access
  // Note: workspace.userId is available on the workspace object
  const subscription = await getUserSubscription(workspace.userId);
  const isPro = subscription?.isActive;

  console.log(
    `[Query] workspaceId=${workspaceId}, docSource=${workspace.DocSource.productName}, status=${workspace.DocSource.status}, chunks=${workspace.DocSource.chunkCount}, isPro=${isPro}`,
  );

  // Use LangGraph agent if enabled
  if (useLangGraph) {
    try {
      const result = await runQueryAgent(
        prompt,
        workspace.docSourceId,
        workspace.DocSource.rootUrl,
        workspace.DocSource.productName,
      );

      return {
        content: result.answer,
        sources: result.sources,
        references: result.sources.map((url, i) => ({
          index: i + 1,
          url,
          title: url.split("/").pop() || "Reference",
        })),
        wasDecomposed: false, // Agent handles this internally
        wasReranked: true,
        confidence: result.confidence,
        usedWebFallback: result.usedWebFallback,
      };
    } catch (error) {
      console.error("LangGraph agent error, falling back:", error);
      // Fall through to legacy handler
    }
  }

  // Legacy handler (fallback)
  let { decompose, reasons } = shouldDecompose(prompt);

  if (decompose && !isPro) {
    console.log(
      "   🔒 [handler] Deep Research blocked (Free Plan). Falling back to Standard.",
    );
    decompose = false;
    reasons = ["Free Plan limit"];
  }

  console.log(
    `   📋 [handler +${Date.now() - handlerStart}ms] Query analysis: decompose=${decompose}, reasons=${reasons.join(", ")}`,
  );

  if (!decompose) {
    console.log(`   📋 [handler] Using SIMPLE query path...`);
    return await handleSimpleQuery(prompt, workspaceId, {
      provider,
      useReranker,
      topK,
    });
  }

  console.log(`   📋 [handler] Using COMPLEX query path (decomposition)...`);
  return await handleComplexQuery(prompt, workspaceId, {
    provider,
    useReranker,
  });
}

async function handleSimpleQuery(
  prompt: string,
  workspaceId: string,
  options: { provider: ModelProvider; useReranker: boolean; topK: number },
): Promise<QueryResult> {
  const simpleStart = Date.now();
  const { provider, useReranker, topK } = options;

  console.log(
    `      🔍 [simple +0ms] Starting vector search (topK=${topK}, rerank=${useReranker})...`,
  );
  const searchResult = await searchDocs(prompt, workspaceId, {
    topK,
    useReranker,
    provider,
  });
  console.log(
    `      🔍 [simple +${Date.now() - simpleStart}ms] Search complete: ${searchResult.chunks.length} chunks, confidence=${searchResult.confidence}`,
  );

  console.log(
    `      ✨ [simple +${Date.now() - simpleStart}ms] Generating answer with ${provider}...`,
  );
  const answer = await generateAnswer(prompt, searchResult.chunks, provider);
  console.log(
    `      ✨ [simple +${Date.now() - simpleStart}ms] Answer generated (${answer.content.length} chars)`,
  );

  return {
    ...answer,
    wasDecomposed: false,
    wasReranked: searchResult.wasReranked,
    confidence: searchResult.confidence,
  };
}

async function handleComplexQuery(
  prompt: string,
  workspaceId: string,
  options: { provider: ModelProvider; useReranker: boolean },
): Promise<QueryResult> {
  const { provider, useReranker } = options;

  const queries = await decomposeQuery(prompt, provider);

  const { results } = await searchMultiple(
    queries.map((q) => q.query),
    workspaceId,
    {
      topKPerQuery: 3,
      useReranker,
      provider,
    },
  );

  const queryResults = new Map<
    string,
    { intent: string; chunks: SearchResult[] }
  >();
  let overallConfidence: "high" | "medium" | "low" = "high";
  let anyReranked = false;

  for (const query of queries) {
    const result = results.get(query.query);
    if (result) {
      queryResults.set(query.query, {
        intent: query.intent,
        chunks: result.chunks,
      });

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

  const answer = await generateCombinedAnswer(prompt, queryResults, provider);

  return {
    ...answer,
    wasDecomposed: true,
    wasReranked: anyReranked,
    queries,
    confidence: overallConfidence,
  };
}

export { searchDocs, generateAnswer };
