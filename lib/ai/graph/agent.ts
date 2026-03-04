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
import { invokeModel } from "../models";
import type { ModelProvider } from "../model-options";
import { AgentState, createInitialState } from "./state";
import {
  rerankDocsFunction,
  generateAnswerFunction,
  agentTools,
} from "./tools";
import { retrieveWithKg } from "../query/search";
import { buildAgentPrompt } from "./prompt";
import {
  MAX_AGENT_HOPS,
  isInsufficientAnswer,
  CONFIDENCE_HIGH_THRESHOLD,
} from "../constants";
import { gradeContextSufficiency } from "./grader";
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
  chatHistory: Annotation<{ role: string; content: string }[]>,
  chatSummary: Annotation<string>,
  preloadedResults: Annotation<AgentState["preloadedResults"]>,
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

  // ── SKIP if preloaded results exist (already Cohere-reranked by handler) ──
  if (state.preloadedResults && state.preloadedResults.length > 0) {
    const topScore = state.preloadedResults[0]?.score || 0;
    console.log(
      `\n🤖 [Graph] ──── retrieve ──── SKIPPED (preloaded ${state.preloadedResults.length} chunks, topScore=${topScore.toFixed(3)})`,
    );
    onStream?.({
      type: "tool_end",
      tool: "deep_vector_search",
      result: {
        chunks: state.preloadedResults.length,
        topScore: Number(topScore.toFixed(3)),
        skipped: true,
        reason: "preloaded from handler (already Cohere-reranked)",
      },
    });
    return { searchResults: state.preloadedResults, topScore };
  }

  console.log(`\n🤖 [Graph] ──── retrieve ──── START`);
  console.log(`   📝 Query: "${state.query.slice(0, 80)}"`);
  console.log(`   📦 DocSource: ${state.docSourceId}`);

  onStream?.({
    type: "tool_start",
    tool: "deep_vector_search",
    input: { query: state.query.slice(0, 80) },
  });

  try {
    const { results, topScore, kgPageCount, kgEntityCount } = await withRetry(
      () => retrieveWithKg(state.query, state.docSourceId, 20),
      1,
    );

    console.log(
      `🤖 [Graph] ──── retrieve ──── END (${Date.now() - start}ms) | ${results.length} results | topScore=${topScore.toFixed(3)} | kg_boosted=${kgPageCount}/${results.length} (${kgEntityCount} entities)`,
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
        kgBoosted: kgPageCount,
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

// ─── RERANK DECISION ───
// Reranking costs latency (~300–600ms). Only do it when it adds value:
//   HIGH confidence  → vector scores are already trustworthy, skip rerank
//   < 5 candidates  → not enough spread to compare meaningfully, skip
//   MEDIUM / LOW with enough candidates → rerank (biggest ROI here)
const RERANK_MIN_CANDIDATES = 5;

function shouldRerank(topScore: number, candidateCount: number): boolean {
  if (topScore >= CONFIDENCE_HIGH_THRESHOLD) {
    console.log(
      `   ⚡ [Rerank] Skipping — high confidence (${topScore.toFixed(3)} >= ${CONFIDENCE_HIGH_THRESHOLD}), vector order is trustworthy`,
    );
    return false;
  }
  if (candidateCount < RERANK_MIN_CANDIDATES) {
    console.log(
      `   ⚡ [Rerank] Skipping — too few candidates (${candidateCount} < ${RERANK_MIN_CANDIDATES})`,
    );
    return false;
  }
  console.log(
    `   ⚡ [Rerank] Proceeding — medium/low confidence (${topScore.toFixed(3)}) with ${candidateCount} candidates`,
  );
  return true;
}

async function rerankNode(
  state: GraphState,
  config: RunnableConfig,
): Promise<Partial<GraphState>> {
  const onStream = config?.configurable?.onStream as OnStream | undefined;
  const start = Date.now();

  // ── SKIP if results were preloaded (already Cohere-reranked by handler) ──
  if (state.preloadedResults && state.preloadedResults.length > 0) {
    const top = state.preloadedResults.slice(0, 5);
    console.log(
      `\n🤖 [Graph] ──── rerank ──── SKIPPED (preloaded, already Cohere-reranked) | using top ${top.length} chunks`,
    );
    onStream?.({
      type: "tool_end",
      tool: "deep_rerank",
      result: {
        reranked: top.length,
        topScore: Number((top[0]?.score || 0).toFixed(3)),
        skipped: true,
        reason: "preloaded from handler (already Cohere-reranked)",
      },
    });
    return { rerankedResults: top };
  }

  const candidates = state.searchResults.slice(0, 10);

  console.log(`\n🤖 [Graph] ──── rerank ──── START`);
  console.log(
    `   📊 Candidates: ${candidates.length} | topScore=${state.topScore.toFixed(3)}`,
  );

  onStream?.({
    type: "tool_start",
    tool: "deep_rerank",
    input: { candidates: candidates.length },
  });

  // Skip rerank when it won't add value
  if (!shouldRerank(state.topScore, candidates.length)) {
    const top = candidates.slice(0, 5);
    console.log(
      `🤖 [Graph] ──── rerank ──── SKIPPED (${Date.now() - start}ms) | using top ${top.length} vector results`,
    );
    onStream?.({
      type: "tool_end",
      tool: "deep_rerank",
      result: {
        reranked: top.length,
        confidence: state.confidence,
        topScore: Number(state.topScore.toFixed(3)),
        skipped: true,
      },
    });
    return { rerankedResults: top };
  }

  try {
    const { reranked, confidence, topScore } = await withRetry(
      () => rerankDocsFunction(state.query, candidates, 5),
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
        skipped: false,
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
    const fallback = candidates.slice(0, 5);
    onStream?.({
      type: "tool_end",
      tool: "deep_rerank",
      result: { error: msg, reranked: fallback.length },
    });
    return {
      rerankedResults: fallback,
      errors: [`rerank: ${msg}`],
    };
  }
}

// ─── FAST-PATH SCORE FOR THE GRADER BYPASS ───
// If Cohere rerank score already clears this bar, skip the LLM grader entirely.
const GRADE_FAST_PATH_THRESHOLD = 0.6;

async function gradeNode(
  state: GraphState,
  config: RunnableConfig,
): Promise<Partial<GraphState>> {
  const onStream = config?.configurable?.onStream as OnStream | undefined;
  const start = Date.now();

  const chunks =
    state.rerankedResults.length > 0
      ? state.rerankedResults
      : state.searchResults.slice(0, 5);

  // ── Fast bypass: high Cohere score → no need to call the LLM grader ──
  if (state.topScore >= GRADE_FAST_PATH_THRESHOLD && chunks.length >= 2) {
    console.log(
      `\n🤖 [Graph] ──── grade ──── FAST PATH (topScore=${state.topScore.toFixed(3)} >= ${GRADE_FAST_PATH_THRESHOLD}) → contextSufficient=true`,
    );
    onStream?.({
      type: "tool_end",
      tool: "context_grader",
      result: { isSufficient: true, skipped: true, reason: "high topScore" },
    });
    return { isContextSufficient: true, confidence: "high" };
  }

  // ── No chunks at all → definitely insufficient ──
  if (chunks.length === 0) {
    console.log(
      `\n🤖 [Graph] ──── grade ──── NO CHUNKS → contextSufficient=false`,
    );
    onStream?.({
      type: "tool_end",
      tool: "context_grader",
      result: { isSufficient: false, skipped: true, reason: "no chunks" },
    });
    return { isContextSufficient: false, confidence: "low" };
  }

  console.log(
    `\n🤖 [Graph] ──── grade ──── START (${chunks.length} chunks, topScore=${state.topScore.toFixed(3)})`,
  );
  onStream?.({
    type: "tool_start",
    tool: "context_grader",
    input: { chunks: chunks.length, query: state.query.slice(0, 80) },
  });

  const isSufficient = await gradeContextSufficiency(state.query, chunks);

  console.log(
    `🤖 [Graph] ──── grade ──── END (${Date.now() - start}ms) | isSufficient=${isSufficient}`,
  );
  onStream?.({
    type: "tool_end",
    tool: "context_grader",
    result: { isSufficient, chunks: chunks.length },
  });

  return {
    isContextSufficient: isSufficient,
    confidence: isSufficient ? "medium" : "low",
  };
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

      // Build context from reranked or raw results to pass to LLM
      const chunks =
        state.rerankedResults.length > 0
          ? state.rerankedResults
          : state.searchResults.slice(0, 5);
      const retrievedContext =
        chunks.length > 0
          ? chunks
              .map(
                (r, i) =>
                  `[${i + 1}] **${r.metadata.title}** (${r.metadata.url})\n${r.metadata.content.slice(0, 800)}`,
              )
              .join("\n\n")
          : undefined;

      const systemPrompt = buildAgentPrompt(
        state.productName,
        state.docsSiteUrl,
        retrievedContext,
        state.chatSummary,
        state.chatHistory,
        !state.isContextSufficient, // tells LLM it MUST search when grader said insufficient
      );
      messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(state.query),
      ];
    }

    const agentModelId =
      process.env.AGENT_MODEL_ID || "llama-3.3-70b-versatile";
    const model = new ChatGroq({
      model: agentModelId,
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

async function webGenerateNode(
  state: GraphState,
  config: RunnableConfig,
): Promise<Partial<GraphState>> {
  const onStream = config?.configurable?.onStream as OnStream | undefined;
  const start = Date.now();
  console.log(`\n🤖 [Graph] ──── web_generate ──── START`);

  onStream?.({
    type: "tool_start",
    tool: "deep_generate",
    input: { source: "web_results" },
  });

  // Collect scraped content from tool messages
  const webContent: { url: string; title: string; content: string }[] = [];
  for (const msg of state.messages) {
    if (msg._getType() === "tool") {
      try {
        const parsed = JSON.parse(
          typeof msg.content === "string" ? msg.content : "",
        );
        if (parsed.scrapedPages) {
          for (const page of parsed.scrapedPages) {
            if (page.url && !webContent.some((w) => w.url === page.url)) {
              webContent.push(page);
            }
          }
        }
      } catch {
        // skip non-JSON
      }
    }
  }

  // Also check last AI message for a direct text answer
  const lastAI = [...state.messages]
    .reverse()
    .find((m) => m._getType() === "ai" && !(m as AIMessage).tool_calls?.length);
  if (lastAI && typeof lastAI.content === "string" && lastAI.content.trim()) {
    // The LLM already wrote an answer — use it
    const sources = webContent.map((w) => w.url);
    console.log(
      `🤖 [Graph] ──── web_generate ──── END (${Date.now() - start}ms) | LLM answer ${lastAI.content.length} chars | ${sources.length} sources`,
    );
    onStream?.({
      type: "tool_end",
      tool: "deep_generate",
      result: { length: lastAI.content.length, sources: sources.length },
    });
    return {
      answer: `⚠️ **Note**: This answer is based on web search results, not indexed documentation.\n\n${lastAI.content}`,
      sources,
      finished: true,
    };
  }

  // No text answer from LLM — generate one from scraped pages + vector results
  const allChunks = [
    ...state.rerankedResults,
    ...(state.rerankedResults.length === 0
      ? state.searchResults.slice(0, 5)
      : []),
  ];

  // Add web content as synthetic chunks
  for (const page of webContent) {
    allChunks.push({
      id: `web-${webContent.indexOf(page)}`,
      score: 0.9,
      metadata: {
        url: page.url,
        title: page.title,
        section: "",
        docSourceId: state.docSourceId,
        content: page.content.slice(0, 2000),
        urlHash: "",
        chunkIndex: 0,
        productName: state.productName,
        indexedAt: new Date().toISOString(),
      },
    });
  }

  if (allChunks.length === 0) {
    const answer = `I couldn't find relevant information about "${state.query}" in the ${state.productName} documentation, even after searching the web.`;
    onStream?.({
      type: "tool_end",
      tool: "deep_generate",
      result: { length: answer.length, fallback: true },
    });
    return { answer, sources: [], finished: true };
  }

  try {
    const { answer, sources } = await generateAnswerFunction(
      state.query,
      allChunks,
      state.productName,
      true,
    );

    console.log(
      `🤖 [Graph] ──── web_generate ──── END (${Date.now() - start}ms) | ${answer.length} chars | ${sources.length} sources`,
    );
    onStream?.({
      type: "tool_end",
      tool: "deep_generate",
      result: { length: answer.length, sources: sources.length },
    });

    return { answer, sources, finished: true };
  } catch (error) {
    const msg = (error as Error).message;
    console.error(`❌ [Graph] web_generate failed: ${msg}`);
    onStream?.({
      type: "tool_end",
      tool: "deep_generate",
      result: { error: msg },
    });
    return {
      answer: "I encountered an error generating an answer. Please try again.",
      sources: [],
      finished: true,
      errors: [`web_generate: ${msg}`],
    };
  }
}

// ─── ROUTING LOGIC ───
// Routing is driven by the LLM grader verdict (isContextSufficient).
// gradeNode sets isContextSufficient — fast-bypasses when topScore is already high.

function routeAfterGrade(
  state: GraphState,
): "web_agent" | "generate" | "fallback_generate" {
  if (state.isContextSufficient) {
    console.log(
      `🔀 [Graph] Route grade: context SUFFICIENT → generate`,
    );
    return "generate";
  }

  // Context graded insufficient — try web search for Pro users
  if (state.isPro && (process.env.TAVILY_API_KEY || process.env.SEARXNG_URL)) {
    console.log(
      `🔀 [Graph] Route grade: context INSUFFICIENT + isPro + provider → web_agent`,
    );
    return "web_agent";
  }

  if (state.isPro) {
    console.log(
      `🔀 [Graph] Route grade: context INSUFFICIENT + isPro (no provider) → generate`,
    );
    return "generate";
  }

  console.log(`🔀 [Graph] Route grade: free user → fallback_generate`);
  return "fallback_generate";
}

function routeWebAgent(state: GraphState): "tools" | "web_generate" {
  // ── Hard limit: force generate after MAX_AGENT_HOPS ──
  if (state.hopCount >= MAX_AGENT_HOPS) {
    console.log(
      `🔀 [Graph] Route web_agent: hop limit reached (${state.hopCount}/${MAX_AGENT_HOPS}) → web_generate`,
    );
    return "web_generate";
  }

  // ── Too many errors: bail out ──
  if (state.errors.length > 2) {
    console.log(
      `🔀 [Graph] Route web_agent: too many errors (${state.errors.length}) → web_generate`,
    );
    return "web_generate";
  }

  const lastMessage = state.messages[state.messages.length - 1];

  // ── No message or not AI: force generate ──
  if (!lastMessage || lastMessage._getType() !== "ai") {
    console.log(`🔀 [Graph] Route web_agent: no AI message → web_generate`);
    return "web_generate";
  }

  const aiMsg = lastMessage as AIMessage;
  const hasToolCalls = !!aiMsg.tool_calls?.length;
  const hasTextContent =
    typeof aiMsg.content === "string" && aiMsg.content.trim().length > 50;

  // ── If LLM wrote a text answer (no tool calls), go to web_generate ──
  if (!hasToolCalls) {
    console.log(
      `🔀 [Graph] Route web_agent: no tool calls, hasText=${hasTextContent} → web_generate`,
    );
    return "web_generate";
  }

  // ── LLM wants to call tools — allow it ──
  console.log(
    `🔀 [Graph] Route web_agent: toolCalls=${aiMsg.tool_calls?.length} hopCount=${state.hopCount} → tools`,
  );
  return "tools";
}

// ─── GRAPH CONSTRUCTION ───
//
// retrieve → rerank → grade → routeAfterGrade
//   ├─ isContextSufficient=true  → generate → END   (fast path)
//   ├─ Pro + provider            → web_agent         (LLM MUST search if grader said insufficient)
//   │                                ├─ tool_calls → tools → web_agent  (max 2-3 hops)
//   │                                └─ no tool_calls → web_generate → END
//   └─ Free / no provider        → fallback_generate → END

function buildGraph() {
  const workflow = new StateGraph(StateAnnotation)
    .addNode("retrieve", retrieveNode)
    .addNode("rerank", rerankNode)
    .addNode("grade", gradeNode)
    .addNode("generate", generateNode)
    .addNode("fallback_generate", fallbackGenerateNode)
    .addNode("web_agent", webAgentNode)
    .addNode("web_generate", webGenerateNode)
    .addNode("tools", new ToolNode(agentTools))

    .addEdge(START, "retrieve")
    .addEdge("retrieve", "rerank")
    .addEdge("rerank", "grade")

    .addConditionalEdges("grade", routeAfterGrade, {
      web_agent: "web_agent",
      generate: "generate",
      fallback_generate: "fallback_generate",
    })

    .addConditionalEdges("web_agent", routeWebAgent, {
      tools: "tools",
      web_generate: "web_generate",
    })
    .addEdge("tools", "web_agent")

    .addEdge("generate", END)
    .addEdge("web_generate", END)
    .addEdge("fallback_generate", END);

  return workflow.compile();
}

export const queryAgent = buildGraph();

// ─── DOMAIN RELEVANCE CHECK ───

// Fast regex patterns that are CLEARLY off-topic regardless of product.
// Only triggers for generic programming tasks with no possible doc connection.
const OFFTOPIC_PATTERNS =
  /\b(recipe|cook|food|weather|forecast|sports|score|movie|film|song|lyrics|translate|poem|story|joke|calculate\s+\d|solve\s+this\s+(equation|math)|write\s+(a\s+)?(bubble|merge|quick|insertion)\s+sort|two\s*sum|fibonacci|factorial|palindrome)\b/i;

// Doc-related signals — if any of these are present, skip LLM call entirely.
const DOC_SIGNALS =
  /\b(how|why|what|configure|setup|install|error|api|sdk|deploy|integrate|use|enable|disable|debug|fix|migrate|upgrade|example|code|snippet)\b/i;

export async function isDomainRelevant(
  query: string,
  productName: string,
  chatMessages?: Array<Record<string, unknown>>,
): Promise<{ relevant: boolean; reason: string }> {
  const q = query.toLowerCase();

  // Fast pass: clearly a doc/tech question → skip LLM entirely
  if (DOC_SIGNALS.test(q)) {
    return { relevant: true, reason: "fast-pass: doc signal detected" };
  }

  // Fast fail: clearly off-topic → skip LLM entirely
  if (OFFTOPIC_PATTERNS.test(q)) {
    return { relevant: false, reason: "fast-fail: off-topic pattern matched" };
  }

  // Follow-up heuristic: short ambiguous messages in an ongoing conversation
  // (e.g. "give me an example", "what about sources", "ok try it") are almost
  // always references to the previous answer — treat them as relevant.
  const isShortFollowUp =
    chatMessages && chatMessages.length >= 2 && query.trim().length < 80;
  if (isShortFollowUp) {
    return { relevant: true, reason: "follow-up in ongoing conversation" };
  }

  // Ambiguous — use small LLM to decide, with recent context if available
  const smallProvider = (process.env.SMALL_MODEL_PROVIDER ||
    "groq") as ModelProvider;
  const smallModelId = process.env.SMALL_MODEL_ID || "llama-3.1-8b-instant";

  // Build a brief conversation snippet so the LLM knows what the user is referring to
  let recentContext = "";
  if (chatMessages && chatMessages.length > 0) {
    const recent = chatMessages.slice(-3);
    recentContext = recent
      .map((m) => {
        const role = (m.role as string) === "assistant" ? "Assistant" : "User";
        const content =
          typeof m.content === "string"
            ? m.content
            : (
                m.parts as Array<{ type: string; text?: string }> | undefined
              )?.find((p) => p.type === "text")?.text || "";
        return `${role}: ${content.slice(0, 120)}`;
      })
      .join("\n");
  }

  try {
    const response = await invokeModel(
      smallProvider,
      [
        {
          role: "system",
          content: `You are a query classifier for a documentation chatbot. The user is in a workspace for "${productName}".

Determine if the query could POSSIBLY be answered using ${productName} documentation.
Reply ONLY with JSON: {"relevant": true/false, "reason": "brief reason"}

Rules — default to relevant: true when uncertain:
- Anything about ${productName} features, API, config, setup, pricing → true
- Integrating ${productName} with any framework or tool → true
- Follow-up questions referencing a prior answer → true
- Generic programming algorithms with no connection to ${productName} → false
- Non-technical questions (recipes, weather, sports) → false`,
        },
        {
          role: "user",
          content: recentContext
            ? `Recent conversation:\n${recentContext}\n\nNew message: ${query}`
            : query,
        },
      ],
      smallModelId,
    );

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Fail open — assume relevant to avoid false rejections
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
  chatHistory: { role: string; content: string }[] = [],
  chatSummary: string = "",
  preloadedResults: import("../pinecone").SearchResult[] = [],
) {
  const startTime = Date.now();
  console.log(`\n🤖 [LangGraph] ========== AGENT START ==========`);
  if (chatHistory.length > 0) {
    console.log(`   💬 Chat history: ${chatHistory.length} recent messages`);
  }
  if (chatSummary) {
    console.log(`   📝 Chat summary: ${chatSummary.length} chars`);
  }
  if (preloadedResults.length > 0) {
    console.log(
      `   ⚡ Preloaded: ${preloadedResults.length} chunks (skip retrieve+rerank)`,
    );
  }

  if (onStream) {
    onStream({ type: "agent_start", runId: docSourceId });
  }

  // Domain guard already ran in route.ts before RAG search.
  // No need to repeat it here.

  const initialState = createInitialState(
    query,
    docSourceId,
    docsSiteUrl,
    productName,
    isPro,
    chatHistory,
    chatSummary,
    preloadedResults,
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

  const finalAnswer = result.answer || "No answer generated.";
  const finalSources = result.sources || [];

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
