export type ModelProvider = "groq" | "openai" | "gemini";

export interface ModelOption {
  id: string;
  provider: ModelProvider;
  modelId: string;
  name: string;
  description: string;
  category: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "groq/llama-3.3-70b",
    provider: "groq",
    modelId: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B",
    description: "Fast & capable",
    category: "Groq",
  },
  {
    id: "groq/llama-3.1-8b",
    provider: "groq",
    modelId: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B",
    description: "Ultra fast",
    category: "Groq",
  },
  {
    id: "groq/gpt-oss-120b",
    provider: "groq",
    modelId: "openai/gpt-oss-120b",
    name: "GPT OSS 120B",
    description: "Large open-source model",
    category: "Groq",
  },
  {
    id: "gemini/flash",
    provider: "gemini",
    modelId: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    description: "Fast & efficient",
    category: "Google",
  },
  {
    id: "gemini/pro",
    provider: "gemini",
    modelId: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    description: "High quality",
    category: "Google",
  },
  {
    id: "openai/gpt-4o-mini",
    provider: "openai",
    modelId: "gpt-4o-mini",
    name: "GPT-4o Mini",
    description: "Cost effective",
    category: "OpenAI",
  },
  {
    id: "openai/gpt-4o",
    provider: "openai",
    modelId: "gpt-4o",
    name: "GPT-4o",
    description: "Most capable",
    category: "OpenAI",
  },
];

export const DEFAULT_MODEL_ID = "groq/gpt-oss-120b";

export function getModelOption(id: string): ModelOption {
  return MODEL_OPTIONS.find((m) => m.id === id) || MODEL_OPTIONS[0];
}

export function getModelCategories(): string[] {
  const seen = new Set<string>();
  return MODEL_OPTIONS.filter((m) => {
    if (seen.has(m.category)) return false;
    seen.add(m.category);
    return true;
  }).map((m) => m.category);
}
