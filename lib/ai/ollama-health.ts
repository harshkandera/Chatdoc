import type { ModelProvider } from "./model-options";

// ─── Ollama Health Check & Provider Failover ──────────────────────────────────
//
// Single point of failure mitigation for the self-hosted Ollama instance.
// All code that needs SMALL_MODEL_PROVIDER or EMBEDDING_PROVIDER should
// call these functions instead of reading env vars directly.
//
// Strategy:
//   - LLM calls:   Ollama → Groq fallback
//   - Embeddings:  Ollama → Gemini fallback (Groq has no embedding API)
//   - Health check is cached for 30s to avoid hammering Ollama on every call
//
// ──────────────────────────────────────────────────────────────────────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

/** How long a successful health check result is trusted (ms) */
const HEALTH_CACHE_TTL_MS = 30_000;

/** Timeout for the health check ping itself (ms) */
const HEALTH_CHECK_TIMEOUT_MS = 3_000;

// ─── Cached health state ──────────────────────────────────────────────────────

let ollamaHealthy: boolean | null = null;
let lastHealthCheck = 0;

/**
 * Ping Ollama's lightweight / endpoint (returns version info).
 * Result is cached for HEALTH_CACHE_TTL_MS so we don't ping on every call.
 */
export async function isOllamaHealthy(): Promise<boolean> {
  const now = Date.now();
  if (ollamaHealthy !== null && now - lastHealthCheck < HEALTH_CACHE_TTL_MS) {
    return ollamaHealthy;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const res = await fetch(OLLAMA_BASE_URL, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timer);

    ollamaHealthy = res.ok;
    lastHealthCheck = now;

    if (!ollamaHealthy) {
      console.warn(
        `[Ollama] Health check failed: HTTP ${res.status} — falling back to cloud providers`,
      );
    }
    return ollamaHealthy;
  } catch (error) {
    ollamaHealthy = false;
    lastHealthCheck = now;
    const msg =
      (error as Error).name === "AbortError"
        ? `timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`
        : (error as Error).message;
    console.warn(
      `[Ollama] Health check failed: ${msg} — falling back to cloud providers`,
    );
    return false;
  }
}

/**
 * Force-reset the health cache (e.g., after recovering from an outage).
 */
export function resetOllamaHealthCache(): void {
  ollamaHealthy = null;
  lastHealthCheck = 0;
}

// ─── Provider Resolution ──────────────────────────────────────────────────────

/**
 * Get the effective LLM provider for small model calls.
 * If SMALL_MODEL_PROVIDER=ollama but Ollama is down → returns "groq".
 *
 * Usage (replace raw env reads):
 *   BEFORE: const provider = (process.env.SMALL_MODEL_PROVIDER || "groq") as ModelProvider;
 *   AFTER:  const provider = await getSmallModelProvider();
 */
export async function getSmallModelProvider(): Promise<{
  provider: ModelProvider;
  modelId: string;
  isFallback: boolean;
}> {
  const configuredProvider = (process.env.SMALL_MODEL_PROVIDER ||
    "groq") as ModelProvider;
  const configuredModelId = process.env.SMALL_MODEL_ID || "";

  if (configuredProvider !== "ollama") {
    return {
      provider: configuredProvider,
      modelId: configuredModelId || "llama-3.1-8b-instant",
      isFallback: false,
    };
  }

  // Ollama is configured — check health
  const healthy = await isOllamaHealthy();
  if (healthy) {
    return {
      provider: "ollama",
      modelId:
        configuredModelId || process.env.OLLAMA_LLM_MODEL || "qwen2.5:14b",
      isFallback: false,
    };
  }

  // Ollama down → fall back to Groq
  console.warn(`[Failover] LLM: ollama → groq (Ollama unreachable)`);
  return {
    provider: "groq",
    modelId: "llama-3.1-8b-instant",
    isFallback: true,
  };
}

/**
 * Get the effective embedding provider.
 * If EMBEDDING_PROVIDER=ollama but Ollama is down → returns "gemini".
 * (Groq does not offer embeddings, so we fall back to Gemini.)
 */
export async function getEmbeddingProvider(): Promise<{
  provider: "ollama" | "gemini" | "openai";
  isFallback: boolean;
}> {
  const configured = (process.env.EMBEDDING_PROVIDER || "gemini") as
    | "ollama"
    | "gemini"
    | "openai";

  if (configured !== "ollama") {
    return { provider: configured, isFallback: false };
  }

  // Ollama is configured — check health
  const healthy = await isOllamaHealthy();
  if (healthy) {
    return { provider: "ollama", isFallback: false };
  }

  // Ollama down → fall back to Gemini (Groq has no embedding API)
  console.warn(`[Failover] Embeddings: ollama → gemini (Ollama unreachable)`);
  return { provider: "gemini", isFallback: true };
}
