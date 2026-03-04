import { ChatGroq } from "@langchain/groq";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import * as ai from "ai";
import { getAIModel } from "./providers";
import { getSmallModelProvider } from "./ollama-health";

export type { ModelProvider } from "./model-options";
import type { ModelProvider } from "./model-options";

// ── LangChain models (used ONLY by LangGraph agent) ──

const llmCache = new Map<string, ReturnType<typeof createLLM>>();

function createLLM(provider: ModelProvider, modelId?: string) {
  switch (provider) {
    case "openai":
      return new ChatOpenAI({
        model: modelId || "gpt-4o-mini",
        temperature: 0.1,
        apiKey: process.env.OPENAI_API_KEY!,
      });
    case "gemini":
      return new ChatGoogleGenerativeAI({
        model: modelId || "gemini-1.5-flash",
        temperature: 0.1,
        apiKey: process.env.GOOGLE_API_KEY!,
      });
    case "ollama":
      return new ChatOllama({
        model: modelId || process.env.OLLAMA_LLM_MODEL || "qwen2.5:14b",
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
        temperature: 0.1,
      });
    case "groq":
    default:
      return new ChatGroq({
        model:
          modelId || process.env.LARGE_MODEL_ID || "llama-3.3-70b-versatile",
        temperature: 0.1,
        apiKey: process.env.GROQ_API_KEY!,
      });
  }
}

export function getLLM(provider: ModelProvider = "groq", modelId?: string) {
  const cacheKey = `${provider}:${modelId || "default"}`;
  const cached = llmCache.get(cacheKey);
  if (cached) return cached;
  const llm = createLLM(provider, modelId);
  llmCache.set(cacheKey, llm);
  return llm;
}

// ── AI SDK model calls (used by RAG pipeline) ──

import { traceable } from "langsmith/traceable";
import { wrapAISDK } from "langsmith/experimental/vercel";

const { generateText: wrappedGenerateText } = wrapAISDK(ai);

/**
 * Invoke a model via AI SDK with automatic Ollama → Groq failover.
 *
 * When the caller passes provider="ollama" but Ollama is unreachable,
 * the call transparently falls back to Groq so the pipeline doesn't break.
 */
export const invokeModel = traceable(
  async (
    provider: ModelProvider,
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    modelId?: string,
  ): Promise<string> => {
    let effectiveProvider = provider;
    let effectiveModelId = modelId;

    // If caller wants Ollama, check health and failover to Groq if down
    if (provider === "ollama") {
      const resolved = await getSmallModelProvider();
      effectiveProvider = resolved.provider;
      effectiveModelId = modelId || resolved.modelId;
      if (resolved.isFallback) {
        console.log(
          `   ⚡ [invokeModel] Ollama → Groq failover (model: ${effectiveModelId})`,
        );
      }
    }

    const { text } = await wrappedGenerateText({
      model: getAIModel(effectiveProvider, effectiveModelId),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      experimental_telemetry: { isEnabled: true, functionId: "invokeModel" },
    });
    return text;
  },
  { name: "invoke-model", run_type: "llm" },
);
