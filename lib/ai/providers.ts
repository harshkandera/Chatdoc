import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ModelProvider } from "./model-options";

export const groq = createGroq({ apiKey: process.env.GROQ_API_KEY! });
export const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });
export const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY! });

export function getAIModel(
  provider: ModelProvider = "groq",
  modelId?: string,
) {
  switch (provider) {
    case "openai":
      return openai(modelId || "gpt-4o-mini");
    case "gemini":
      return google(modelId || "gemini-1.5-flash");
    case "groq":
    default:
      return groq(modelId || "llama-3.3-70b-versatile");
  }
}

