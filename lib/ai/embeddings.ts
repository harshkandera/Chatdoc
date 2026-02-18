import { GoogleGenAI } from "@google/genai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { traceable } from "langsmith/traceable";

// Choose embedding provider based on environment
// NOTE: Pinecone index is configured with 768 dimensions

const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || "gemini";
const EMBEDDING_DIMENSION = 768;

// Initialize Google GenAI client
const googleAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY! });

// OpenAI embeddings (fallback option with 768 dimensions)
const openaiEmbeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  dimensions: EMBEDDING_DIMENSION,
  apiKey: process.env.OPENAI_API_KEY!,
});

// Generate embedding using Google GenAI directly (supports outputDimensionality)
// Wrapped with traceable so LangSmith can track these calls
const generateGeminiEmbedding = traceable(
  async (text: string): Promise<number[]> => {
    const response = await googleAI.models.embedContent({
      model: "gemini-embedding-001",
      contents: text,
      config: {
        outputDimensionality: EMBEDDING_DIMENSION,
      },
    });
    return response.embeddings?.[0]?.values ?? [];
  },
  { name: "gemini-embedding", run_type: "embedding" },
);

// Generate multiple embeddings using Google GenAI
const generateGeminiEmbeddings = traceable(
  async (texts: string[]): Promise<number[][]> => {
    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await generateGeminiEmbedding(text);
      embeddings.push(embedding);
    }
    return embeddings;
  },
  { name: "gemini-embeddings-batch", run_type: "embedding" },
);

// Main export: generate a single embedding
export const generateEmbedding = traceable(
  async (text: string): Promise<number[]> => {
    if (EMBEDDING_PROVIDER === "openai") {
      return await openaiEmbeddings.embedQuery(text);
    }
    return await generateGeminiEmbedding(text);
  },
  { name: "generate-embedding", run_type: "embedding" },
);

// Generate embeddings for multiple texts
export const generateEmbeddings = traceable(
  async (texts: string[]): Promise<number[][]> => {
    if (EMBEDDING_PROVIDER === "openai") {
      return await openaiEmbeddings.embedDocuments(texts);
    }
    return await generateGeminiEmbeddings(texts);
  },
  { name: "generate-embeddings-batch", run_type: "embedding" },
);

// For backward compatibility - returns an object with embedQuery/embedDocuments methods
export function getEmbeddings() {
  if (EMBEDDING_PROVIDER === "openai") {
    return openaiEmbeddings;
  }
  // Return a compatible interface for Gemini
  return {
    embedQuery: generateGeminiEmbedding,
    embedDocuments: generateGeminiEmbeddings,
  };
}
