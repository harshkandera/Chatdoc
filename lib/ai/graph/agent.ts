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
import { gradeContextSufficiency } from "./grader";
import { MAX_AGENT_HOPS, isInsufficientAnswer } from "../constants";
import type { StreamEvent } from "../types";

// ─── RETRY HELPER ───

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = 1,
  delayMs: number = 500,
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === retries) throw error;
      console.warn(
        `   ⚠️ Retry ${attempt + 1}/${retries}: ${(error as Error).message}`,
      );
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw new Error("Unreachable");
}

// ─── STATE ANNOTATION ───

const StateAnnotation = Annotation.Root({
  query: Annotation<string>,
  docSourceId: Annotation<string>,
  docsSiteUrl: Annotation<string>,
  productName: Annotation<string>,
  isPro: Annotation<boolean>,
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
  searchResults: Annotation<AgentState["searchResults"]>,
  rerankedResults: Annotation<AgentState["rerankedResults"]>,
  webResults: Annotation<AgentState["webResults"]>,
  confidence: Annotation<AgentState["confidence"]>,
  topScore: Annotation<number>,
  isContextSufficient: Annotation<boolean>,
  hopCount: Annotation<number>,
  usedWebFallback: Annotation<boolean>,
  answer: Annotation<string | undefined>,
  sources: Annotation<string[]>,
  finished: Annotation<boolean>,
  subQueries: Annotation<AgentState["subQueries"]>,
  errors: Annotation<string[]>({
    reducer: (x, y) => x.concat(y),
  }),
});

type GraphState = typeof StateAnnotation.State;

type OnStream = (event: StreamEvent) => void;

const GRAPH_RECURSION_LIMIT = 25;

// ─── NODES ───

async function retrieveNode(
  state: GraphState,
  config: RunnableConfig,
): Promise<Partial<GraphState>> {
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

  try {
    const results = await withRetry(
      () => searchDocsFunction(state.query, state.docSourceId, 20),
      1,
    );

    const topScore = results.length > 0 ? results[0].score : 0;

    console.log(
      `🤖 [Graph] ──── retrieve ──── END (${Date.now() - start}ms) | ${results.length} results | topScore=${topScore.toFixed(3)}`,
    );

    const uniqueUrls = Array.from(
      new Set(results.map((r) => r.metadata.url).filter(Boolean)),
    ).slice(0, 3);

    onStream?.({
      type: "tool_end",
      tool: "deep_vector_search",
      result: {
        chunks: results.length,
        topScore: Number(topScore.toFixed(3)),
        urls: uniqueUrls,
      },
    });

    return { searchResults: results, topScore };
  } catch (error) {
    const msg = (error as Error).message;
    console.error(`❌ [Graph] retrieve failed: ${msg}`);
    onStream?.({
      type: "tool_end",
      tool: "deep_vector_search",
      result: { error: msg },
    });
    return {
      searchResults: [],
      topScore: 0,
      errors: [`retrieve: ${msg}`],
    };
  }
}

async function gradeContextNode(
  state: GraphState,
  config: RunnableConfig,
): Promise<Partial<GraphState>> {
  const onStream = config?.configurable?.onStream as OnStream | undefined;
  const start = Date.now();
  console.log(`\n🤖 [Graph] ──── grade_context ──── START`);
  console.log(`   📊 Chunks to grade: ${state.searchResults.length}`);

  onStream?.({
    type: "tool_start",
    tool: "context_grader",
    input: { chunks: state.searchResults.length },
  });

  const isContextSufficient = await gradeContextSufficiency(
    state.query,
    state.searchResults,
  );

  console.log(
    `🤖 [Graph] ──── grade_context ──── END (${Date.now() - start}ms) | isContextSufficient=${isContextSufficient}`,
  );

  onStream?.({
    type: "tool_end",
    tool: "context_grader",
    result: { isContextSufficient },
  });

  return { isContextSufficient };
}

async function rerankNode(
  state: GraphState,
  config: RunnableConfig,
): Promise<Partial<GraphState>> {
  const onStream = config?.configurable?.onStream as OnStream | undefined;
  const start = Date.now();
  console.log(`\n🤖 [Graph] ──── rerank ──── START`);
  console.log(`   📊 Candidates: ${state.searchResults.length} (using top 8)`);

  onStream?.({
    type: "tool_start",
    tool: "deep_rerank",
    input: { candidates: state.searchResults.length },
  });

  try {
    const candidates = state.searchResults.slice(0, 8);
    const { reranked, confidence, topScore } = await withRetry(
      () => rerankDocsFunction(state.query, candidates, 8),
      1,
    );

    console.log(
      `🤖 [Graph] ──── rerank ──── END (${Date.now() - start}ms) | ${reranked.length} reranked | confidence=${confidence} | topScore=${topScore.toFixed(3)}`,
    );

    onStream?.({
      type: "tool_end",
      tool: "deep_rerank",
      result: {
        reranked: reranked.length,
        confidence,
        topScore: Number(topScore.toFixed(3)),
      },
    });

    return {
      rerankedResults: reranked,
      confidence: confidence as "high" | "medium" | "low",
      topScore,
    };
  } catch (error) {
    const msg = (error as Error).message;
    console.error(`❌ [Graph] rerank failed: ${msg}`);
    onStream?.({
      type: "tool_end",
      tool: "deep_rerank",
      result: { error: msg },
    });
    return {
      rerankedResults: [],
      errors: [`rerank: ${msg}`],
    };
  }
}

async function generateNode(
  state: GraphState,
  config: RunnableConfig,
): Promise<Partial<GraphState>> {
  const onStream = config?.configurable?.onStream as OnStream | undefined;
  const start = Date.now();
  console.log(`\n🤖 [Graph] ──── generate ──── START`);

  const chunks =
    state.rerankedResults.length > 0
      ? state.rerankedResults
      : state.searchResults.slice(0, 5);

  console.log(
    `   📚 Using ${chunks.length} chunks (${state.rerankedResults.length > 0 ? "reranked" : "raw search"})`,
  );

  onStream?.({
    type: "tool_start",
    tool: "deep_generate",
    input: { chunks: chunks.length },
  });

  try {
    const { answer, sources } = await generateAnswerFunction(
      state.query,
      chunks,
      state.productName,
      false,
    );

    const sufficient = !isInsufficientAnswer(answer);
    console.log(
      `🤖 [Graph] ──── generate ──── END (${Date.now() - start}ms) | ${answer.length} chars | sufficient=${sufficient} | sources=${sources.length}`,
    );

    onStream?.({
      type: "tool_end",
      tool: "deep_generate",
      result: { length: answer.length, sufficient, sources: sources.length },
    });

    return { answer, sources, finished: sufficient };
  } catch (error) {
    const msg = (error as Error).message;
    console.error(`❌ [Graph] generate failed: ${msg}`);
    onStream?.({
      type: "tool_end",
      tool: "deep_generate",
      result: { error: msg },
    });
    return {
      answer: "I encountered an error generating an answer. Please try again.",
      sources: [],
      finished: true,
      errors: [`generate: ${msg}`],
    };
  }
}

async function fallbackGenerateNode(
  state: GraphState,
  config: RunnableConfig,
): Promise<Partial<GraphState>> {
  const onStream = config?.configurable?.onStream as OnStream | undefined;
  const start = Date.now();
  console.log(`\n🤖 [Graph] ──── fallback_generate ──── START`);
  console.log(
    `   📚 Best-effort answer for free user (${state.searchResults.length} raw chunks)`,
  );

  onStream?.({
    type: "tool_start",
    tool: "fallback_generate",
    input: { chunks: state.searchResults.length },
  });

  const chunks = state.searchResults.slice(0, 5);

  if (chunks.length === 0) {
    const answer = `I couldn't find relevant information about "${state.query}" in the ${state.productName} documentation.\n\n💡 **Upgrade to Pro** for access to Deep Research mode, which can search the official documentation directly for better answers.`;

    onStream?.({
      type: "tool_end",
      tool: "fallback_generate",
      result: { length: answer.length, fallback: true },
    });

    return { answer, sources: [], finished: true };
  }

  try {
    const { answer, sources } = await generateAnswerFunction(
      state.query,
      chunks,
      state.productName,
      false,
    );

    const finalAnswer = `${answer}\n\n---\n💡 **Want better answers?** Upgrade to Pro for Deep Research mode, which searches official documentation directly when indexed content falls short.`;

    console.log(
      `🤖 [Graph] ──── fallback_generate ──── END (${Date.now() - start}ms) | ${finalAnswer.length} chars`,
    );

    onStream?.({
      type: "tool_end",
      tool: "fallback_generate",
      result: { length: finalAnswer.length, fallback: true },
    });

    return { answer: finalAnswer, sources, finished: true };
  } catch (error) {
    const msg = (error as Error).message;
    console.error(`❌ [Graph] fallback_generate failed: ${msg}`);
    onStream?.({
      type: "tool_end",
      tool: "fallback_generate",
      result: { error: msg },
    });
    return {
      answer: "I encountered an error generating an answer. Please try again.",
      sources: [],
      finished: true,
      errors: [`fallback_generate: ${msg}`],
    };
  }
}

async function webAgentNode(
  state: GraphState,
  config: RunnableConfig,
): Promise<Partial<GraphState>> {
  const onStream = config?.configurable?.onStream as OnStream | undefined;
  const start = Date.now();
  console.log(`\n🤖 [Graph] ──── web_agent (Slow Path) ──── START`);
  console.log(
    `   🌐 Product: ${state.productName} | Site: ${state.docsSiteUrl}`,
  );
  console.log(`   📨 Messages so far: ${state.messages.length}`);

  onStream?.({
    type: "tool_start",
    tool: "web_search_docs",
    input: { query: state.query.slice(0, 80), product: state.productName },
  });

  try {
    let messages = state.messages;
    if (messages.length === 0) {
      console.log(`   🔧 Initializing agent with system prompt + user query`);
      const systemPrompt = buildAgentPrompt(
        state.productName,
        state.docsSiteUrl,
      );
      messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(state.query),
      ];
    }

    const model = new ChatGroq({
      model: "openai/gpt-oss-120b",
      temperature: 0,
    }).bindTools(agentTools);

    const response = await withRetry(() => model.invoke(messages), 1, 1000);

    const toolCalls = (response as AIMessage).tool_calls;
    console.log(
      `🤖 [Graph] ──── web_agent ──── END (${Date.now() - start}ms) | toolCalls=${toolCalls?.length ?? 0} | usedWebFallback=true`,
    );
    if (toolCalls?.length) {
      toolCalls.forEach((tc, i) =>
        console.log(
          `   🔧 Tool[${i}]: ${tc.name}(${JSON.stringify(tc.args).slice(0, 80)})`,
        ),
      );
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
  } catch (error) {
    const msg = (error as Error).message;
    console.error(`❌ [Graph] web_agent failed: ${msg}`);
    onStream?.({
      type: "tool_end",
      tool: "web_search_docs",
      result: { error: msg },
    });
    return {
      hopCount: state.hopCount + 1,
      usedWebFallback: true,
      errors: [`web_agent: ${msg}`],
    };
  }
}

// ─── ROUTING LOGIC ───
// Routing is based on semantic answerability (isContextSufficient),
// NOT vector scores. Scores are kept for telemetry only.

function routeAfterGrade(
  state: GraphState,
): "rerank" | "web_agent" | "fallback_generate" {
  if (state.isContextSufficient) {
    console.log(
      `🔀 [Graph] Route grade_context: isContextSufficient=true → rerank`,
    );
    return "rerank";
  }

  if (state.isPro && process.env.TAVILY_API_KEY) {
    console.log(
      `🔀 [Graph] Route grade_context: isContextSufficient=false + isPro → web_agent`,
    );
    return "web_agent";
  }

  console.log(
    `🔀 [Graph] Route grade_context: isContextSufficient=false + free user → fallback_generate`,
  );
  return "fallback_generate";
}

function routeAfterGenerate(state: GraphState): "end" | "web_agent" {
  if (state.finished) {
    console.log(`🔀 [Graph] Route generate: sufficient answer → end`);
    return "end";
  }

  if (
    state.isPro &&
    process.env.TAVILY_API_KEY &&
    state.hopCount < MAX_AGENT_HOPS
  ) {
    console.log(
      `🔀 [Graph] Route generate: insufficient + isPro + hops=${state.hopCount} → web_agent`,
    );
    return "web_agent";
  }

  console.log(
    `🔀 [Graph] Route generate: insufficient but cannot escalate → end`,
  );
  return "end";
}

function routeWebAgent(state: GraphState): "tools" | "end" {
  if (state.hopCount >= MAX_AGENT_HOPS) {
    console.log(
      `🔀 [Graph] Route web_agent: hop limit reached (${state.hopCount}/${MAX_AGENT_HOPS}) → end`,
    );
    return "end";
  }

  if (state.errors.length > 3) {
    console.log(
      `🔀 [Graph] Route web_agent: too many errors (${state.errors.length}) → end`,
    );
    return "end";
  }

  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage || lastMessage._getType() !== "ai") {
    console.log(`🔀 [Graph] Route web_agent: no AI message → end`);
    return "end";
  }

  const hasToolCalls = !!(lastMessage as AIMessage).tool_calls?.length;
  const decision = hasToolCalls ? "tools" : "end";
  console.log(
    `🔀 [Graph] Route web_agent: hasToolCalls=${hasToolCalls} hopCount=${state.hopCount} → ${decision}`,
  );
  return decision;
}

// ─── GRAPH CONSTRUCTION ───
//
// retrieve → grade_context → routeAfterGrade
//   ├─ sufficient    → rerank → generate → routeAfterGenerate
//   │                                       ├─ sufficient → END
//   │                                       └─ insufficient + Pro → web_agent
//   ├─ insufficient + Pro  → web_agent → routeWebAgent
//   │                                    ├─ tool_calls → tools → web_agent
//   │                                    └─ no tool_calls → END
//   └─ insufficient + Free → fallback_generate → END

function buildGraph() {
  const workflow = new StateGraph(StateAnnotation)
    .addNode("retrieve", retrieveNode)
    .addNode("grade_context", gradeContextNode)
    .addNode("rerank", rerankNode)
    .addNode("generate", generateNode)
    .addNode("fallback_generate", fallbackGenerateNode)
    .addNode("web_agent", webAgentNode)
    .addNode("tools", new ToolNode(agentTools))

    .addEdge(START, "retrieve")
    .addEdge("retrieve", "grade_context")

    .addConditionalEdges("grade_context", routeAfterGrade, {
      rerank: "rerank",
      web_agent: "web_agent",
      fallback_generate: "fallback_generate",
    })

    .addEdge("rerank", "generate")

    .addConditionalEdges("generate", routeAfterGenerate, {
      end: END,
      web_agent: "web_agent",
    })

    .addConditionalEdges("web_agent", routeWebAgent, {
      tools: "tools",
      end: END,
    })
    .addEdge("tools", "web_agent")

    .addEdge("fallback_generate", END);

  return workflow.compile();
}

export const queryAgent = buildGraph();

// ─── DOMAIN RELEVANCE CHECK ───

export async function isDomainRelevant(
  query: string,
  productName: string,
): Promise<{ relevant: boolean; reason: string }> {
  const model = new ChatGroq({
    model: "llama-3.1-8b-instant",
    temperature: 0,
  });

  try {
    const response = await model.invoke([
      new SystemMessage(
        `You are a query classifier for a documentation chatbot. The user is currently in a workspace for "${productName}".

Determine if the query could POSSIBLY be answered using ${productName} documentation.

Reply with ONLY a JSON object: {"relevant": true/false, "reason": "brief reason"}

Rules — be GENEROUS, default to relevant: true:
- Questions about ${productName} features, API, setup, pricing, configuration → relevant: true
- Questions about integrating ${productName} with ANY framework or tool (Next.js, React, Python, etc.) → relevant: true
- Questions about webhooks, SDKs, billing, checkout, subscriptions in context of ${productName} → relevant: true
- Implementation/code/setup questions (e.g. "webhook code for next js", "how to install next js") → relevant: true (the user is in ${productName} workspace, so they mean ${productName})
- ONLY mark false for questions that are completely disconnected from ${productName} (e.g., general programming algorithms like "write a C++ two sum", explaining unrelated concepts like "CSS flexbox", or non-technical questions like "recipe for pancakes")
- When in doubt → relevant: true`,
      ),
      new HumanMessage(query),
    ]);

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // If classification fails, assume relevant to avoid false rejections
  }
  return {
    relevant: true,
    reason: "classification failed, defaulting to relevant",
  };
}

// ─── MAIN ENTRY POINT ───

export async function runQueryAgent(
  query: string,
  docSourceId: string,
  docsSiteUrl: string,
  productName: string,
  isPro: boolean,
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
    isPro,
  );

  console.log(
    `🤖 [LangGraph] Invoking graph with configurable: { docSourceId=${docSourceId}, docsSiteUrl=${docsSiteUrl}, productName=${productName}, isPro=${isPro} }`,
  );

  let result: GraphState;
  try {
    result = await queryAgent.invoke(initialState, {
      recursionLimit: GRAPH_RECURSION_LIMIT,
      configurable: {
        docSourceId,
        docsSiteUrl,
        productName,
        onStream,
      },
    });
  } catch (error) {
    console.error(`❌ [LangGraph] Graph invocation failed:`, error);
    if (onStream) {
      onStream({
        type: "text",
        content:
          "I encountered an error during deep research. Please try again.",
      });
      onStream({ type: "finish", sources: [] });
    }
    return {
      answer: "I encountered an error during deep research. Please try again.",
      sources: [],
      confidence: "low" as const,
      usedWebFallback: false,
    };
  }

  console.log(
    `🤖 [LangGraph] Graph complete — finished=${result.finished}, isContextSufficient=${result.isContextSufficient}, usedWebFallback=${result.usedWebFallback}, hopCount=${result.hopCount}, errors=${result.errors?.length ?? 0}`,
  );

  if (result.errors?.length) {
    console.warn(
      `   ⚠️ [LangGraph] Accumulated errors: ${result.errors.join("; ")}`,
    );
  }

  let finalAnswer = result.answer || "No answer generated.";
  let finalSources = result.sources || [];

  if (!result.finished && result.messages && result.messages.length > 0) {
    const lastAIMessage = [...result.messages]
      .reverse()
      .find(
        (m: BaseMessage) =>
          m._getType() === "ai" && !(m as AIMessage).tool_calls?.length,
      );
    if (lastAIMessage) {
      const content = lastAIMessage.content;
      if (typeof content === "string" && content.trim()) {
        finalAnswer = `⚠️ **Note**: This answer is based on web search results, not indexed documentation.\n\n${content}`;
      }
    }

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
  console.log(
    `   🔗 Sources: ${finalSources.length} (${finalSources.slice(0, 3).join(", ")}${finalSources.length > 3 ? "..." : ""})`,
  );
  console.log(`   🌐 Web fallback: ${result.usedWebFallback || false}`);
  console.log(`🤖 [LangGraph] ========== AGENT END ==========\n`);

  return {
    answer: finalAnswer,
    sources: finalSources,
    confidence: result.confidence || "low",
    usedWebFallback: result.usedWebFallback || false,
  };
}
