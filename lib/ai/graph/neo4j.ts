import neo4j, { Driver } from "neo4j-driver";

// ─── Singleton driver ─────────────────────────────────────────────────────────

let _driver: Driver | null = null;

export function isNeo4jEnabled(): boolean {
  // Set KG_ENABLED=false in env to disable all KG operations without touching code.
  // Remove that var (or set it to "true") to re-enable.
  if (process.env.KG_ENABLED === "false") return false;
  return !!(
    process.env.NEO4J_URI &&
    process.env.NEO4J_USERNAME &&
    process.env.NEO4J_PASSWORD
  );
}

function getDriver(): Driver {
  if (_driver) return _driver;
  if (!isNeo4jEnabled()) {
    throw new Error(
      "Neo4j not configured. Set NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD.",
    );
  }

  _driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(
      process.env.NEO4J_USERNAME!,
      process.env.NEO4J_PASSWORD!,
    ),
    {
      maxConnectionPoolSize: 10,
      connectionTimeout: 10000,              // correct key — was connectionTimeoutMs (ignored)
      connectionAcquisitionTimeout: 15000,   // correct key — was connectionAcquisitionTimeoutMs (ignored)
    },
  );

  return _driver;
}

// ─── Public helpers ────────────────────────────────────────────────────────────

/**
 * Execute a Cypher query and return typed records.
 * Always opens a new session and closes it after the query.
 */
const CYPHER_TIMEOUT_MS = 20_000; // 20s per query — fail fast on AuraDB cold start

export async function runCypher<T = Record<string, unknown>>(
  query: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const session = getDriver().session();
  try {
    const result = await Promise.race([
      session.run(query, params),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Neo4j query timed out after ${CYPHER_TIMEOUT_MS}ms`)),
          CYPHER_TIMEOUT_MS,
        ),
      ),
    ]);
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

/**
 * Create uniqueness constraints once on first setup.
 * Safe to call multiple times (IF NOT EXISTS).
 */
export async function setupNeo4jConstraints(): Promise<void> {
  const session = getDriver().session();
  try {
    await session.run(
      "CREATE CONSTRAINT IF NOT EXISTS FOR (p:Page) REQUIRE p.id IS UNIQUE",
    );
    await session.run(
      "CREATE CONSTRAINT IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE",
    );
    console.log("[Neo4j] Constraints ensured.");
  } finally {
    await session.close();
  }
}
