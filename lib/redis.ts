import Redis from "ioredis";
import { createHash } from "crypto";

let client: Redis | null = null;

function getRedis(): Redis {
  if (client) return client;

  const host = process.env.REDIS_HOST;
  const port = parseInt(process.env.REDIS_PORT || "6379", 10);
  const password = process.env.REDIS_PASSWORD;

  if (!host) {
    throw new Error("REDIS_HOST is not set");
  }

  console.log(`[Redis] connecting to ${host}:${port} (password: ${password ? "set" : "not set"})`);

  client = new Redis({ host, port, password, lazyConnect: true });

  client.on("connect", () => {
    console.log(`[Redis] connected to ${host}:${port}`);
  });

  client.on("ready", () => {
    console.log(`[Redis] ready`);
  });

  client.on("error", (err) => {
    console.error(`[Redis] error: ${err.message}`);
  });

  client.on("close", () => {
    console.warn(`[Redis] connection closed`);
  });

  return client;
}

// ─── Embedding cache ──────────────────────────────────────────────────────────
// Key: embed:<sha256-of-text>   TTL: 7 days
// We store the float32 array as a JSON string.

const EMBED_TTL = 60 * 60 * 24 * 7; // 7 days

function embedKey(text: string): string {
  // SHA-256 to avoid the ~1/4B collision rate of the old djb2 32-bit hash
  return `embed:${createHash("sha256").update(text).digest("hex")}`;
}

export async function getCachedEmbedding(
  text: string,
): Promise<number[] | null> {
  try {
    const redis = getRedis();
    const val = await redis.get(embedKey(text));
    if (!val) return null;
    return JSON.parse(val) as number[];
  } catch {
    return null;
  }
}

export async function setCachedEmbedding(
  text: string,
  embedding: number[],
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(embedKey(text), JSON.stringify(embedding), "EX", EMBED_TTL);
  } catch {
    // non-fatal
  }
}

// ─── RAG result cache ─────────────────────────────────────────────────────────
// Key: rag:<docSourceId>:<sha256-of-query>   TTL: 10 minutes

const RAG_TTL = 60 * 10; // 10 minutes

function ragKey(docSourceId: string, query: string): string {
  return `rag:${docSourceId}:${createHash("sha256").update(query).digest("hex")}`;
}

export async function getCachedRagResult<T>(
  docSourceId: string,
  query: string,
): Promise<T | null> {
  try {
    const redis = getRedis();
    const val = await redis.get(ragKey(docSourceId, query));
    if (!val) return null;
    return JSON.parse(val) as T;
  } catch {
    return null;
  }
}

export async function setCachedRagResult<T>(
  docSourceId: string,
  query: string,
  result: T,
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(
      ragKey(docSourceId, query),
      JSON.stringify(result),
      "EX",
      RAG_TTL,
    );
  } catch {
    // non-fatal
  }
}

// ─── Indexing status Pub/Sub ──────────────────────────────────────────────────
// Publisher: called from updateDocSourceStatus after every DB write.
// Subscriber: SSE endpoint holds one Redis subscriber connection per client.

export function indexingChannel(docSourceId: string) {
  return `indexing:${docSourceId}`;
}

export interface IndexingStatusEvent {
  status: string;
  statusMessage: string | null;
  documentCount: number | null;
  chunkCount: number | null;
}

export async function publishIndexingStatus(
  docSourceId: string,
  payload: IndexingStatusEvent,
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.publish(indexingChannel(docSourceId), JSON.stringify(payload));
  } catch {
    // non-fatal — DB is still updated, client will fall back to polling
  }
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Key: rate:<userId>:<window>   TTL: window duration
// Returns true if the request is allowed, false if rate limited.

export async function checkRateLimit(
  userId: string,
  /** Requests allowed per window */
  limit: number,
  /** Window size in seconds */
  windowSecs: number,
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const window = Math.floor(Date.now() / (windowSecs * 1000));
  const key = `rate:${userId}:${window}`;

  try {
    const redis = getRedis();
    // Use a pipeline so SET NX + INCR + TTL are sent in one round-trip and the
    // expiry is always applied — avoids the TOCTOU gap of the old incr→expire pattern
    // where a crash between the two commands left the key without an expiry.
    const pipeline = redis.pipeline();
    pipeline.set(key, "0", "EX", windowSecs, "NX"); // Set only if not exists
    pipeline.incr(key);
    pipeline.ttl(key);
    const results = await pipeline.exec();

    const count = (results?.[1]?.[1] as number) ?? 1;
    const ttl = (results?.[2]?.[1] as number) ?? windowSecs;

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetIn: ttl,
    };
  } catch {
    // Redis unavailable → fail open (allow request)
    return { allowed: true, remaining: limit, resetIn: windowSecs };
  }
}
