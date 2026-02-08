import { ChatGroq } from "@langchain/groq";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";

export type ModelProvider = "groq" | "openai" | "gemini";

// Groq - Fast and free
const groqModel = new ChatGroq({
  model: "llama-3.3-70b-versatile",
  temperature: 0.1,
  apiKey: process.env.GROQ_API_KEY!,
});

// OpenAI - Best quality
const openaiModel = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.1,
  apiKey: process.env.OPENAI_API_KEY!,
});

// Gemini - Google's model
const geminiModel = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-flash",
  temperature: 0.1,
  apiKey: process.env.GOOGLE_API_KEY!,
});

// Get LLM by provider
export function getLLM(provider: ModelProvider = "groq") {
  switch (provider) {
    case "openai":
      return openaiModel;
    case "gemini":
      return geminiModel;
    case "groq":
    default:
      return groqModel;
  }
}

// Simple invoke helper
export async function invokeModel(
  provider: ModelProvider,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<string> {
  const model = getLLM(provider);

  const response = await model.invoke(
    messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  );

  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
}
