import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import {
  BaseMessage,
  SystemMessage,
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatGroq } from "@langchain/groq";
import { AgentState, createInitialState } from "./state";
import {
  searchDocsFunction,
  rerankDocsFunction,
  generateAnswerFunction,
  agentTools,
} from "./tools";
import { buildAgentPrompt } from "./prompt";
import {
  VECTOR_CONFIDENCE_THRESHOLD,
  RERANK_LOW_THRESHOLD,
  MAX_AGENT_HOPS,
  isInsufficientAnswer,
} from "../constants";
import type { StreamEvent } from "../types";

// State annotation
const StateAnnotation = Annotation.Root({
  query: Annotation<string>,
  docSourceId: Annotation<string>,
  docsSiteUrl: Annotation<string>,
  productName: Annotation<string>,
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
  searchResults: Annotation<AgentState["searchResults"]>,
  rerankedResults: Annotation<AgentState["rerankedResults"]>,
  webResults: Annotation<AgentState["webResults"]>,
  confidence: Annotation<AgentState["confidence"]>,
  topScore: Annotation<number>,
  hopCount: Annotation<number>,
  usedWebFallback: Annotation<boolean>,
  answer: Annotation<string | undefined>,
  sources: Annotation<string[]>,
  finished: Annotation<boolean>,
  subQueries: Annotation<AgentState["subQueries"]>,
});

type GraphState = typeof StateAnnotation.State;

type OnStream = (event: StreamEvent) => void;

// ─── NODES ───

// 1. Retrieve Node (Deterministic Vector Search)
async function retrieveNode(state: GraphState, config: RunnableConfig): Promise<Partial<GraphState>> {
  const onStream = config?.configurable?.onStream as OnStream | undefined;
  const start = Date.now();
  console.log(`\n🤖 [Graph] ──── retrieve ──── START`);
  console.log(`   📝 Query: "${state.query.slice(0, 80)}"`);
  console.log(`   📦 DocSource: ${state.docSourceId}`);

  onStream?.({
    type: "tool_start",
    tool: "deep_vector_search",
    input: { query: state.query.slice(0, 80) },
  });

  const results = await searchDocsFunction(state.query, state.docSourceId, 20);

  let topScore = 0;
  if (results.length > 0) {
    topScore = results[0].score;
  }

  console.log(`🤖 [Graph] ──── retrieve ──── END (${Date.now() - start}ms) | ${results.length} results | topScore=${topScore.toFixed(3)}`);

  onStream?.({
    type: "tool_end",
    tool: "deep_vector_search",
    result: { chunks: results.length, topScore: Number(topScore.toFixed(3)) },
  });

  return {
    searchResults: results,
    topScore,
  };
}

// 2. Rerank Node (Conditional)
async function rerankNode(state: GraphState, config: RunnableConfig): Promise<Partial<GraphState>> {
  const onStream = config?.configurable?.onStream as OnStream | undefined;
  const start = Date.now();
  console.log(`\n🤖 [Graph] ──── rerank ──── START`);
  console.log(`   📊 Candidates: ${state.searchResults.length} (using top 8)`);

  onStream?.({
    type: "tool_start",
    tool: "deep_rerank",
    input: { candidates: state.searchResults.length },
  });

  const candidates = state.searchResults.slice(0, 8);
  const { reranked, confidence, topScore } = await rerankDocsFunction(
    state.query,
    candidates,
    8,
  );

  console.log(`🤖 [Graph] ──── rerank ──── END (${Date.now() - start}ms) | ${reranked.length} reranked | confidence=${confidence} | topScore=${topScore.toFixed(3)}`);

  onStream?.({
    type: "tool_end",
    tool: "deep_rerank",
    result: { reranked: reranked.length, confidence, topScore: Number(topScore.toFixed(3)) },
  });

  return {
    rerankedResults: reranked,
    confidence: confidence as "high" | "medium" | "low",
    topScore,
  };
}

// 3. Generate Answer Node
async function generateNode(state: GraphState, config: RunnableConfig): Promise<Partial<GraphState>> {
  const onStream = config?.configurable?.onStream as OnStream | undefined;
  const start = Date.now();
  console.log(`\n🤖 [Graph] ──── generate ──── START`);

  const chunks =
    state.rerankedResults.length > 0
      ? state.rerankedResults
      : state.searchResults.slice(0, 5);

  console.log(`   📚 Using ${chunks.length} chunks (${state.rerankedResults.length > 0 ? "reranked" : "raw search"})`);

  onStream?.({
    type: "tool_start",
    tool: "deep_generate",
    input: { chunks: chunks.length },
  });

  const { answer, sources } = await generateAnswerFunction(
    state.query,
    chunks,
    state.productName,
    false,
  );

  const sufficient = !isInsufficientAnswer(answer);
  console.log(`🤖 [Graph] ──── generate ──── END (${Date.now() - start}ms) | ${answer.length} chars | sufficient=${sufficient} | sources=${sources.length}`);

  onStream?.({
    type: "tool_end",
    tool: "deep_generate",
    result: { length: answer.length, sufficient, sources: sources.length },
  });

  return {
    answer,
    sources,
    finished: sufficient,
  };
}

// 4. Web/Agent Node (Slow Path)
async function webAgentNode(state: GraphState, config: RunnableConfig): Promise<Partial<GraphState>> {
  const onStream = config?.configurable?.onStream as OnStream | undefined;
  const start = Date.now();
  console.log(`\n🤖 [Graph] ──── web_agent (Slow Path) ──── START`);
  console.log(`   🌐 Product: ${state.productName} | Site: ${state.docsSiteUrl}`);
  console.log(`   📨 Messages so far: ${state.messages.length}`);

  onStream?.({
    type: "tool_start",
    tool: "web_search_docs",
    input: { query: state.query.slice(0, 80), product: state.productName },
  });

  let messages = state.messages;
  if (messages.length === 0) {
    console.log(`   🔧 Initializing agent with system prompt + user query`);
    const systemPrompt = buildAgentPrompt(state.productName, state.docsSiteUrl);
    messages = [new SystemMessage(systemPrompt), new HumanMessage(state.query)];
  }

  const model = new ChatGroq({
    model: "llama-3.3-70b-versatile",
    temperature: 0,
  }).bindTools(agentTools);

  const response = await model.invoke(messages);

  const toolCalls = (response as AIMessage).tool_calls;
  console.log(`🤖 [Graph] ──── web_agent ──── END (${Date.now() - start}ms) | toolCalls=${toolCalls?.length ?? 0} | usedWebFallback=true`);
  if (toolCalls?.length) {
    toolCalls.forEach((tc, i) => console.log(`   🔧 Tool[${i}]: ${tc.name}(${JSON.stringify(tc.args).slice(0, 80)})`));
  }

  onStream?.({
    type: "tool_end",
    tool: "web_search_docs",
    result: { toolCalls: toolCalls?.length ?? 0 },
  });

  return {
    messages: [response],
    usedWebFallback: true,
    hopCount: state.hopCount + 1,
  };
}

// ─── ROUTING LOGIC ───

function routeRetrieve(state: GraphState): "generate" | "rerank" | "web_agent" {
  const score = state.topScore;
  let decision: "generate" | "rerank" | "web_agent";

  if (score >= VECTOR_CONFIDENCE_THRESHOLD) {
    decision = "generate";
  } else if (score >= RERANK_LOW_THRESHOLD) {
    decision = "rerank";
  } else {
    decision = "web_agent";
  }

  console.log(`🔀 [Graph] Route retrieve: topScore=${score.toFixed(3)} | threshold_high=${VECTOR_CONFIDENCE_THRESHOLD} threshold_low=${RERANK_LOW_THRESHOLD} → ${decision}`);
  return decision;
}

function routeRerank(state: GraphState): "generate" | "web_agent" {
  const decision = state.rerankedResults.length > 0 ? "generate" : "web_agent";
  console.log(`🔀 [Graph] Route rerank: confidence=${state.confidence} | rerankedResults=${state.rerankedResults.length} → ${decision}`);
  return decision;
}

function routeGenerate(state: GraphState): "end" | "web_agent" {
  const decision = state.finished ? "end" : "web_agent";
  console.log(`🔀 [Graph] Route generate: finished=${state.finished} | answerLength=${state.answer?.length ?? 0} → ${decision}`);
  return decision;
}

function routeWebAgent(state: GraphState): "tools" | "end" {
  if (state.hopCount >= MAX_AGENT_HOPS) {
    console.log(`🔀 [Graph] Route web_agent: hop limit reached (${state.hopCount}/${MAX_AGENT_HOPS}) → end`);
    return "end";
  }
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const hasToolCalls = !!lastMessage.tool_calls?.length;
  const decision = hasToolCalls ? "tools" : "end";
  console.log(`🔀 [Graph] Route web_agent: hasToolCalls=${hasToolCalls} hopCount=${state.hopCount} → ${decision}`);
  return decision;
}

// ─── GRAPH CONSTRUCTION ───

function buildGraph() {
  const workflow = new StateGraph(StateAnnotation)
    .addNode("retrieve", retrieveNode)
    .addNode("rerank", rerankNode)
    .addNode("generate", generateNode)
    .addNode("web_agent", webAgentNode)
    .addNode("tools", new ToolNode(agentTools)) // Standard ToolNode for agentTools

    // Start -> Retrieve
    .addEdge(START, "retrieve")

    // Retrieve -> Router
    .addConditionalEdges("retrieve", routeRetrieve, {
      generate: "generate",
      rerank: "rerank",
      web_agent: "web_agent",
    })

    // Rerank -> Router
    .addConditionalEdges("rerank", routeRerank, {
      generate: "generate",
      web_agent: "web_agent",
    })

    // Web Agent Loop
    .addConditionalEdges("web_agent", routeWebAgent, {
      tools: "tools",
      end: END,
    })
    .addEdge("tools", "web_agent")

    // Generate -> Router (check if answer is sufficient)
    .addConditionalEdges("generate", routeGenerate, {
      end: END,
      web_agent: "web_agent",
    });

  return workflow.compile();
}

export const queryAgent = buildGraph();

// ─── HELPER FOR TOOL NODE CONFIG ───
// We need to pass docsSiteUrl etc to tool node.
// LangGraph's ToolNode accepts a function that returns config.
// OR we can wrap the tools to inject config.
// For now, let's assume the standard ToolNode works and we might need to patch `tools.ts`
// if `config` isn't passed correctly.
// The `webSearchDocsTool` in `tools.ts` expects `config.configurable.docsSiteUrl`.
// We need to ensure we run the graph with `configurable`.

// ─── UTILS ───

export async function isDomainRelevant(
  query: string,
  productName: string,
): Promise<{ relevant: boolean; reason: string }> {
  const model = new ChatGroq({
    model: "llama-3.1-8b-instant",
    temperature: 0,
  });

  const response = await model.invoke([
    new SystemMessage(
      `You are a query classifier for a documentation chatbot. The user is currently in a workspace for "${productName}".

Determine if the query could POSSIBLY be answered using ${productName} documentation.

Reply with ONLY a JSON object: {"relevant": true/false, "reason": "brief reason"}

Rules — be GENEROUS, default to relevant: true:
- Questions about ${productName} features, API, setup, pricing, configuration → relevant: true
- Questions about integrating ${productName} with ANY framework or tool (Next.js, React, Python, etc.) → relevant: true
- Questions about webhooks, SDKs, billing, checkout, subscriptions in context of ${productName} → relevant: true
- Implementation/code questions (e.g. "webhook code for next js") → relevant: true (the user is in ${productName} workspace, so they mean ${productName})
- ONLY mark false for questions that have ZERO possible connection to ${productName} (e.g. "recipe for pancakes", "explain quantum physics")
- When in doubt → relevant: true`,
    ),
    new HumanMessage(query),
  ]);

  try {
    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // If parsing fails, assume relevant to avoid false rejections
  }
  return {
    relevant: true,
    reason: "classification failed, defaulting to relevant",
  };
}

// Convenience function to run the agent (Promise based, for legacy/testing)
// NOTE: For streaming, use queryAgent.streamEvents() directly.
export async function runQueryAgent(
  query: string,
  docSourceId: string,
  docsSiteUrl: string,
  productName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onStream?: (event: any) => void,
) {
  const startTime = Date.now();
  console.log(`\n🤖 [LangGraph] ========== AGENT START ==========`);

  if (onStream) {
    onStream({ type: "agent_start", runId: docSourceId });
  }

  // ── Domain guard ──
  const domainCheck = await isDomainRelevant(query, productName);
  if (!domainCheck.relevant) {
    const message = `This workspace is specifically for **${productName}** documentation. I can only answer questions related to ${productName}.\n\nTo discuss other topics like ${domainCheck.reason}, please create a separate workspace for that documentation.`;

    if (onStream) {
      onStream({ type: "text", content: message });
      onStream({ type: "finish", sources: [] });
    }
    return {
      answer: message,
      sources: [],
      confidence: "high" as const,
      usedWebFallback: false,
    };
  }

  const initialState = createInitialState(
    query,
    docSourceId,
    docsSiteUrl,
    productName,
  );

  console.log(`🤖 [LangGraph] Invoking graph with configurable: { docSourceId=${docSourceId}, docsSiteUrl=${docsSiteUrl}, productName=${productName} }`);

  const result = await queryAgent.invoke(initialState, {
    configurable: {
      docSourceId,
      docsSiteUrl,
      productName,
      onStream,
    },
  });

  console.log(`🤖 [LangGraph] Graph complete — finished=${result.finished}, confidence=${result.confidence}, usedWebFallback=${result.usedWebFallback}, hopCount=${result.hopCount}`);

  // Extract the final answer:
  // - If generate was sufficient (finished=true), use state.answer
  // - If generate was insufficient and web_agent ran, extract from last AI message
  let finalAnswer = result.answer || "No answer generated.";
  let finalSources = result.sources || [];

  if (!result.finished && result.messages && result.messages.length > 0) {
    const lastAIMessage = [...result.messages]
      .reverse()
      .find(
        (m: BaseMessage) =>
          m._getType() === "ai" &&
          !(m as AIMessage).tool_calls?.length,
      );
    if (lastAIMessage) {
      const content = lastAIMessage.content;
      if (typeof content === "string" && content.trim()) {
        finalAnswer = `⚠️ **Note**: This answer is based on web search results, not indexed documentation.\n\n${content}`;
      }
    }

    // Extract source URLs from web_search_docs tool results
    const toolMessages = result.messages.filter(
      (m: BaseMessage) => m._getType() === "tool",
    );
    const webSources: string[] = [];
    for (const tm of toolMessages) {
      try {
        const toolContent = typeof tm.content === "string" ? tm.content : "";
        const parsed = JSON.parse(toolContent);
        if (parsed.scrapedPages) {
          for (const page of parsed.scrapedPages) {
            if (page.url && !webSources.includes(page.url)) {
              webSources.push(page.url);
            }
          }
        }
      } catch {
        // Ignore non-JSON tool messages
      }
    }
    if (webSources.length > 0) {
      finalSources = webSources;
    }
  }

  if (onStream) {
    onStream({ type: "text", content: finalAnswer });
    onStream({
      type: "finish",
      sources: finalSources,
      confidence: result.confidence,
      usedWebFallback: result.usedWebFallback,
    });
  }

  const elapsed = Date.now() - startTime;
  console.log(`   ⏱️  Duration: ${elapsed}ms`);
  console.log(`   📊 Answer length: ${finalAnswer.length} chars`);
  console.log(`   🔗 Sources: ${finalSources.length} (${finalSources.slice(0, 3).join(", ")}${finalSources.length > 3 ? "..." : ""})`);
  console.log(`   🌐 Web fallback: ${result.usedWebFallback || false}`);
  console.log(`🤖 [LangGraph] ========== AGENT END ==========\n`);

  return {
    answer: finalAnswer,
    sources: finalSources,
    confidence: result.confidence || "low",
    usedWebFallback: result.usedWebFallback || false,
  };
}
