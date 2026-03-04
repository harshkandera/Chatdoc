/**
 * Build the Neo4j knowledge graph from already-indexed Postgres chunks.
 * Run this once to retroactively populate the KG without re-scraping.
 *
 * Usage:
 *   npx tsx scripts/build-kg-from-existing.ts
 *   npx tsx scripts/build-kg-from-existing.ts --docSourceId=<id>  # single doc source
 */
import "dotenv/config";
import neo4j from "neo4j-driver";
import { extractPageKnowledge } from "../lib/ai/graph/kg-builder";
import { prisma } from "../lib/db/prisma";

const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = process.env;
if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
  console.error("Missing env vars: NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD");
  process.exit(1);
}

const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD),
);

async function runCypher(query: string, params: Record<string, unknown> = {}) {
  const session = driver.session();
  try {
    await session.run(query, params);
  } finally {
    await session.close();
  }
}

function pageId(url: string): string {
  return Buffer.from(url).toString("base64url").slice(0, 40);
}

function entityId(docSourceId: string, name: string): string {
  return `${docSourceId}:${name.toLowerCase().replace(/\s+/g, "_")}`;
}

async function buildKgForDocSource(docSourceId: string, productName: string) {
  console.log(`\n[KG] Processing doc source: ${productName} (${docSourceId})`);

  // Load all chunks for this doc source, grouped by URL
  const chunks = await prisma.chunk.findMany({
    where: { docSourceId },
    orderBy: [{ url: "asc" }, { chunkIndex: "asc" }],
    select: { url: true, title: true, content: true, chunkIndex: true },
  });

  if (chunks.length === 0) {
    console.log(`  Skipping — no chunks found.`);
    return;
  }

  // Reconstruct pages from chunks
  const pageMap = new Map<
    string,
    { url: string; title: string; content: string }
  >();
  for (const chunk of chunks) {
    if (!pageMap.has(chunk.url)) {
      pageMap.set(chunk.url, {
        url: chunk.url,
        title: chunk.title,
        content: "",
      });
    }
    const page = pageMap.get(chunk.url)!;
    page.content += (page.content ? "\n\n" : "") + chunk.content;
  }

  const pages = Array.from(pageMap.values());
  console.log(`  ${chunks.length} chunks → ${pages.length} pages`);

  // Clear existing KG data for this doc source
  await runCypher("MATCH (n {docSourceId: $docSourceId}) DETACH DELETE n", {
    docSourceId,
  });

  let entityTotal = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    process.stdout.write(
      `\r  Page ${i + 1}/${pages.length}: ${page.title.slice(0, 50).padEnd(50)}`,
    );

    try {
      const pid = pageId(page.url);

      // Upsert Page node
      await runCypher(
        `MERGE (p:Page {id: $id})
         SET p.url = $url, p.title = $title, p.docSourceId = $docSourceId`,
        { id: pid, url: page.url, title: page.title, docSourceId },
      );

      // Extract entities from this page
      const knowledge = await extractPageKnowledge(page);
      if (knowledge.entities.length === 0) continue;

      for (const entity of knowledge.entities) {
        const eid = entityId(docSourceId, entity.name);
        await runCypher(
          `MERGE (e:Entity {id: $eid})
           SET e.name = $name, e.type = $type, e.docSourceId = $docSourceId
           WITH e
           MATCH (p:Page {id: $pid})
           MERGE (e)-[:MENTIONED_IN]->(p)`,
          { eid, name: entity.name, type: entity.type, docSourceId, pid },
        );
      }
      entityTotal += knowledge.entities.length;

      for (const rel of knowledge.relationships) {
        const fromId = entityId(docSourceId, rel.from);
        const toId = entityId(docSourceId, rel.to);
        await runCypher(
          `MATCH (a:Entity {id: $fromId}), (b:Entity {id: $toId})
           MERGE (a)-[r:RELATED_TO {type: $relType}]->(b)`,
          { fromId, toId, relType: rel.type },
        );
      }
    } catch (err) {
      console.error(`\n  Error on page "${page.url}":`, err);
    }
  }

  console.log(
    `\n  Done: ${entityTotal} entities extracted across ${pages.length} pages`,
  );
}

async function main() {
  // Optional: target a single doc source via CLI arg
  const targetId = process.argv
    .find((a) => a.startsWith("--docSourceId="))
    ?.split("=")[1];

  const docSources = await prisma.docSource.findMany({
    where: targetId ? { id: targetId } : { status: "ready" },
    select: { id: true, productName: true },
  });

  if (docSources.length === 0) {
    console.log("No ready doc sources found.");
    process.exit(0);
  }

  console.log(`Building KG for ${docSources.length} doc source(s)...`);

  for (const ds of docSources) {
    await buildKgForDocSource(ds.id, ds.productName);
  }

  console.log("\nAll done.");
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await driver.close();
  });
