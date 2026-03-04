/**
 * Test script to verify Neo4j connection and inspect indexed data.
 * Run: npx tsx scripts/test-neo4j.ts [docSourceId]
 *
 * Examples:
 *   npx tsx scripts/test-neo4j.ts
 *   npx tsx scripts/test-neo4j.ts clxyz123
 *   npx tsx scripts/test-neo4j.ts clxyz123 --query "how to use useState"
 */

import neo4j from "neo4j-driver";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DOC_SOURCE_ID = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
const queryArg = process.argv.includes("--query")
  ? process.argv[process.argv.indexOf("--query") + 1]
  : undefined;

// ─── Driver ───────────────────────────────────────────────────────────────────

function getDriver() {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !username || !password) {
    console.error("❌ Missing env vars: NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD");
    console.error("   Make sure they are set in .env.local");
    process.exit(1);
  }

  console.log(`🔌 Connecting to: ${uri}`);
  return neo4j.driver(uri, neo4j.auth.basic(username, password));
}

async function run(cypher: string, params = {}, driver: ReturnType<typeof getDriver>) {
  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject());
  } finally {
    await session.close();
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function main() {
  const driver = getDriver();

  try {
    // 1. Connection check
    console.log("\n── 1. Connection ──────────────────────────────────────────");
    await run("RETURN 1 AS ok", {}, driver);
    console.log("✅ Connected to Neo4j successfully");

    // 2. DB stats
    console.log("\n── 2. Database Stats ──────────────────────────────────────");
    const [pageCount] = await run("MATCH (p:Page) RETURN count(p) AS count", {}, driver);
    const [entityCount] = await run("MATCH (e:Entity) RETURN count(e) AS count", {}, driver);
    const [relCount] = await run("MATCH ()-[r]->() RETURN count(r) AS count", {}, driver);

    console.log(`   Pages    : ${pageCount?.count}`);
    console.log(`   Entities : ${entityCount?.count}`);
    console.log(`   Relations: ${relCount?.count}`);

    // 3. DocSource breakdown (if data exists)
    console.log("\n── 3. DocSources in KG ────────────────────────────────────");
    const docSources = await run(
      `MATCH (p:Page)
       RETURN p.docSourceId AS docSourceId, count(p) AS pages
       ORDER BY pages DESC LIMIT 10`,
      {},
      driver,
    );
    if (docSources.length === 0) {
      console.log("   ⚠️  No pages indexed yet in Neo4j");
    } else {
      docSources.forEach((d) =>
        console.log(`   ${d.docSourceId}  →  ${d.pages} pages`),
      );
    }

    // 4. DocSource-specific stats
    if (DOC_SOURCE_ID) {
      console.log(`\n── 4. Stats for docSourceId: ${DOC_SOURCE_ID} ──────────`);

      const pages = await run(
        "MATCH (p:Page {docSourceId: $id}) RETURN p.url AS url, p.title AS title LIMIT 5",
        { id: DOC_SOURCE_ID },
        driver,
      );
      console.log(`   Sample pages (${pages.length}):`);
      pages.forEach((p) => console.log(`     • [${p.title}] ${p.url}`));

      const topEntities = await run(
        `MATCH (e:Entity {docSourceId: $id})-[:MENTIONED_IN]->(p:Page)
         RETURN e.name AS name, e.type AS type, count(p) AS mentions
         ORDER BY mentions DESC LIMIT 10`,
        { id: DOC_SOURCE_ID },
        driver,
      );
      console.log(`\n   Top entities by mention count:`);
      topEntities.forEach((e) =>
        console.log(`     • ${e.name} (${e.type})  →  ${e.mentions} pages`),
      );

      const relTypes = await run(
        `MATCH (e:Entity {docSourceId: $id})-[r:RELATED_TO]->(e2:Entity)
         RETURN r.type AS type, count(r) AS count
         ORDER BY count DESC LIMIT 5`,
        { id: DOC_SOURCE_ID },
        driver,
      );
      console.log(`\n   Relation types:`);
      if (relTypes.length === 0) {
        console.log("     (none found)");
      } else {
        relTypes.forEach((r) => console.log(`     • ${r.type}  →  ${r.count}`));
      }
    }

    // 5. Entity extraction + KG lookup test
    if (queryArg && DOC_SOURCE_ID) {
      console.log(`\n── 5. KG Lookup for query: "${queryArg}" ─────────────────`);

      // Inline entity extraction using your existing logic
      const { default: Groq } = await import("groq-sdk/index.js");
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

      const res = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: `Extract technical entity names from a documentation query.
Return a JSON array of strings — only specific named items: API method names, hook names, class names, config keys, error types.
Do NOT include generic words. Return at most 5. Example: ["useState", "useEffect"]
Return [] if nothing specific found.`,
          },
          { role: "user", content: `Query: ${queryArg}\n\nReturn JSON array:` },
        ],
        temperature: 0,
      });

      const raw = res.choices[0].message.content || "[]";
      const match = raw.match(/\[[\s\S]*?\]/);
      const entities: string[] = match ? JSON.parse(match[0]) : [];
      console.log(`   Extracted entities: ${JSON.stringify(entities)}`);

      if (entities.length > 0) {
        const kgPages = await run(
          `MATCH (e:Entity {docSourceId: $docSourceId})
           WHERE e.name IN $names
           MATCH (e)-[:MENTIONED_IN]->(p:Page)
           RETURN DISTINCT e.name AS entity, p.url AS url, p.title AS title
           LIMIT 10`,
          { docSourceId: DOC_SOURCE_ID, names: entities },
          driver,
        );
        console.log(`   KG matched pages (${kgPages.length}):`);
        kgPages.forEach((p) =>
          console.log(`     • [${p.entity}] ${p.title} — ${p.url}`),
        );

        if (kgPages.length === 0) {
          console.log("   ⚠️  No KG pages found — entities may not be indexed yet");
        }
      }
    }

    console.log("\n✅ All checks complete!\n");
  } catch (err) {
    console.error("\n❌ Test failed:", err);
  } finally {
    await driver.close();
  }
}

main();
