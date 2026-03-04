import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider";
import type { ModelProvider } from "./model-options";

export const groq = createGroq({ apiKey: process.env.GROQ_API_KEY! });
export const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });
export const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY!,
});

// ollama-ai-provider for embeddings (still works with spec v1)
export const ollama = createOllama({
  baseURL: `${process.env.OLLAMA_BASE_URL || "http://localhost:11434"}/api`,
});

// Ollama's OpenAI-compatible endpoint for chat (works with AI SDK v6 / spec v2)
const ollamaChat = createOpenAI({
  baseURL: `${process.env.OLLAMA_BASE_URL || "http://localhost:11434"}/v1`,
  apiKey: "ollama", // Ollama doesn't need a real key
});

export function getAIModel(provider: ModelProvider = "groq", modelId?: string) {
  switch (provider) {
    case "openai":
      return openai(modelId || "gpt-4o-mini");
    case "gemini":
      return google(modelId || "gemini-1.5-flash");
    case "ollama":
      return ollamaChat(
        modelId || process.env.OLLAMA_LLM_MODEL || "qwen2.5:14b",
      );
    case "groq":
    default:
      return groq(
        modelId || process.env.LARGE_MODEL_ID || "llama-3.3-70b-versatile",
      );
  }
}
