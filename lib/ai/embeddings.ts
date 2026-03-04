import { GoogleGenAI } from "@google/genai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { traceable } from "langsmith/traceable";
import { getCachedEmbedding, setCachedEmbedding } from "@/lib/redis";
import { getEmbeddingProvider } from "./ollama-health";

// Abort-signal based timeout for any promise. The underlying request continues
// in the background but the caller gets an error so Inngest can retry the step.
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "Embedding",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

const EMBED_TIMEOUT_MS = 30_000;
// Max concurrent Gemini calls — stay within free-tier rate limits (1500 req/min)
const GEMINI_CONCURRENCY = 5;

// Choose embedding provider based on environment
// Embedding provider and dimension are resolved at runtime via getEmbeddingProvider()
// to support automatic failover when Ollama is down.
const EMBEDDING_DIMENSION = 768;

// Ollama config (self-hosted, free)
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

async function generateOllamaEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
  const data = await res.json();
  return data.embeddings[0];
}

async function generateOllamaEmbeddings(texts: string[]): Promise<number[][]> {
  // 1. Check Redis cache for every text upfront
  const cached = await Promise.all(texts.map((t) => getCachedEmbedding(t)));
  const missIndices = texts.map((_, i) => i).filter((i) => cached[i] === null);

  if (missIndices.length > 0) {
    const missTexts = missIndices.map((i) => texts[i]);

    // Ollama accepts the whole batch in one request — wrap with a timeout so a
    // hung local model doesn't freeze the Inngest step forever.
    const fetchBatch = async (): Promise<number[][]> => {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: missTexts }),
      });
      if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
      const data = await res.json();
      return data.embeddings as number[][];
    };

    const embeddings = await withTimeout(
      fetchBatch(),
      EMBED_TIMEOUT_MS,
      "Ollama embedding",
    );

    for (let j = 0; j < missIndices.length; j++) {
      const idx = missIndices[j];
      cached[idx] = embeddings[j];
      setCachedEmbedding(texts[idx], embeddings[j]).catch(() => {});
    }
  }

  return cached as number[][];
}

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

// Generate multiple embeddings using Google GenAI.
// - Checks Redis cache first (MGET) to avoid re-embedding identical content on retries.
// - Runs uncached texts in parallel (GEMINI_CONCURRENCY at a time) with a per-call timeout.
const generateGeminiEmbeddings = traceable(
  async (texts: string[]): Promise<number[][]> => {
    // 1. Batch-check Redis cache for all texts
    const { getCachedEmbedding: getCache, setCachedEmbedding: setCache } =
      await import("@/lib/redis");
    const cached = await Promise.all(texts.map((t) => getCache(t)));

    // Collect indices that need a fresh API call
    const missIndices = texts
      .map((_, i) => i)
      .filter((i) => cached[i] === null);

    if (missIndices.length > 0) {
      // Process misses in parallel batches of GEMINI_CONCURRENCY
      for (let i = 0; i < missIndices.length; i += GEMINI_CONCURRENCY) {
        const slice = missIndices.slice(i, i + GEMINI_CONCURRENCY);
        const results = await Promise.all(
          slice.map((idx) =>
            withTimeout(
              generateGeminiEmbedding(texts[idx]),
              EMBED_TIMEOUT_MS,
              "Gemini embedding",
            ),
          ),
        );
        // Store results in cached array and prime Redis cache
        for (let j = 0; j < slice.length; j++) {
          const idx = slice[j];
          cached[idx] = results[j];
          // Non-blocking cache write
          setCache(texts[idx], results[j]).catch(() => {});
        }
      }
    }

    return cached as number[][];
  },
  { name: "gemini-embeddings-batch", run_type: "embedding" },
);

// Main export: generate a single embedding (Redis cache → provider with failover)
export const generateEmbedding = traceable(
  async (text: string): Promise<number[]> => {
    const cached = await getCachedEmbedding(text);
    if (cached) return cached;

    // Resolve effective provider (with Ollama health check + failover)
    const { provider: effectiveProvider, isFallback } =
      await getEmbeddingProvider();
    if (isFallback) {
      console.log(
        `   ⚡ [Embeddings] Using ${effectiveProvider} (Ollama failover)`,
      );
    }

    let embedding: number[];
    if (effectiveProvider === "ollama") {
      embedding = await generateOllamaEmbedding(text);
    } else if (effectiveProvider === "openai") {
      embedding = await openaiEmbeddings.embedQuery(text);
    } else {
      embedding = await generateGeminiEmbedding(text);
    }

    await setCachedEmbedding(text, embedding);
    return embedding;
  },
  { name: "generate-embedding", run_type: "embedding" },
);

// Generate embeddings for multiple texts (with failover)
export const generateEmbeddings = traceable(
  async (texts: string[]): Promise<number[][]> => {
    // Resolve effective provider (with Ollama health check + failover)
    const { provider: effectiveProvider, isFallback } =
      await getEmbeddingProvider();
    if (isFallback) {
      console.log(
        `   ⚡ [Embeddings] Batch using ${effectiveProvider} (Ollama failover)`,
      );
    }

    if (effectiveProvider === "ollama") {
      return await generateOllamaEmbeddings(texts);
    } else if (effectiveProvider === "openai") {
      return await openaiEmbeddings.embedDocuments(texts);
    }
    return await generateGeminiEmbeddings(texts);
  },
  { name: "generate-embeddings-batch", run_type: "embedding" },
);

// For backward compatibility - returns an object with embedQuery/embedDocuments methods
export async function getEmbeddings() {
  // Resolve effective provider (with Ollama health check + failover)
  const { provider: effectiveProvider } = await getEmbeddingProvider();

  if (effectiveProvider === "ollama") {
    return {
      embedQuery: generateOllamaEmbedding,
      embedDocuments: generateOllamaEmbeddings,
    };
  } else if (effectiveProvider === "openai") {
    return openaiEmbeddings;
  }
  // Gemini (default + fallback)
  return {
    embedQuery: generateGeminiEmbedding,
    embedDocuments: generateGeminiEmbeddings,
  };
}
