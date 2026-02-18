import { ChatGroq } from "@langchain/groq";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { generateText } from "ai";
import { getAIModel } from "./providers";

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
    case "groq":
    default:
      return new ChatGroq({
        model: modelId || "llama-3.3-70b-versatile",
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

export const invokeModel = traceable(
  async (
    provider: ModelProvider,
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    modelId?: string,
  ): Promise<string> => {
    const { text } = await generateText({
      model: getAIModel(provider, modelId),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      experimental_telemetry: { isEnabled: true, functionId: "invokeModel" },
    });
    return text;
  },
  { name: "invoke-model", run_type: "llm" },
);
