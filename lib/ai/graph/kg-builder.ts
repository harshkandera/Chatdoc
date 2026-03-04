import { invokeModel } from "../models";
import type { ModelProvider } from "../model-options";
import { runCypher, isNeo4jEnabled } from "./neo4j";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractedEntity {
  name: string;
  type: "concept" | "function" | "config" | "error";
}

interface ExtractedRelationship {
  from: string;
  to: string;
  type: "requires" | "see_also" | "prerequisite" | "example_of";
}

interface PageKnowledge {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

// Pages as stored in S3 (matches ScrapedPage in indexer/scrape.ts)
interface Page {
  url: string;
  title: string;
  content: string;
  links: string[];
}

// ─── Entity extraction via LLM ────────────────────────────────────────────────

/**
 * Use an LLM to extract named entities and relationships from a documentation page.
 * Returns at most 10 entities and 5 relationships.
 */
export async function extractPageKnowledge(
  page: Page,
): Promise<PageKnowledge> {
  // Limit input to avoid excessive token usage
  const truncated = page.content.slice(0, 3000);

  try {
    const provider = (process.env.SMALL_MODEL_PROVIDER || "groq") as ModelProvider;
    const response = await invokeModel(provider, [
      {
        role: "system",
        content: `You are a technical documentation analyzer. Extract named entities and relationships from the given documentation page.

Return a JSON object with exactly two keys:
- "entities": array of {name: string, type: "concept"|"function"|"config"|"error"}
  - "function" → API methods, hooks, React components, class methods
  - "config"   → configuration options, env variables, schema fields
  - "error"    → error types, exceptions, status codes
  - "concept"  → abstract ideas, patterns, architecture terms
- "relationships": array of {from: string, to: string, type: "requires"|"see_also"|"prerequisite"|"example_of"}

Rules:
- Only extract specific NAMED items, never generic words like "function", "value", "example"
- Entity names must appear verbatim in the page content
- Max 10 entities, max 5 relationships
- Return valid JSON only, no explanation`,
      },
      {
        role: "user",
        content: `Page title: ${page.title}\n\nContent:\n${truncated}\n\nReturn JSON:`,
      },
    ]);

    // IMPORTANT: use greedy *  not non-greedy *? here.
    // Non-greedy would match the first inner nested {} (e.g. an entity object)
    // instead of the outer response object, producing empty entities every time.
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn(`[KG] No JSON found in LLM response for page "${page.title}". Raw: ${response.slice(0, 200)}`);
      return { entities: [], relationships: [] };
    }

    const parsed = JSON.parse(match[0]) as Partial<PageKnowledge>;
    const entities = (parsed.entities || []).slice(0, 10);
    const relationships = (parsed.relationships || []).slice(0, 5);
    console.log(`[KG] Extracted ${entities.length} entities, ${relationships.length} relationships from "${page.title}"`);
    return { entities, relationships };
  } catch (err) {
    console.error(`[KG] Entity extraction failed for page "${page.title}":`, err);
    return { entities: [], relationships: [] };
  }
}

// ─── Graph building ───────────────────────────────────────────────────────────

function pageId(url: string): string {
  // Stable short ID derived from URL
  return Buffer.from(url).toString("base64url").slice(0, 40);
}

function entityId(docSourceId: string, name: string): string {
  return `${docSourceId}:${name.toLowerCase().replace(/\s+/g, "_")}`;
}

/**
 * Build (or rebuild) the Neo4j knowledge graph for a doc source.
 * Upserts Page + Entity nodes and MENTIONED_IN / RELATED_TO edges.
 * Safe to call multiple times — uses MERGE for idempotency.
 */
export async function buildKnowledgeGraph(
  docSourceId: string,
  pages: Page[],
): Promise<void> {
  if (!isNeo4jEnabled()) return;

  console.log(
    `[KG] Building knowledge graph for ${docSourceId}: ${pages.length} pages`,
  );

  let entityTotal = 0;
  let pageTotal = 0;
  let skipped = 0;

  for (const page of pages) {
    try {
      const pid = pageId(page.url);

      // Upsert Page node
      await runCypher(
        `MERGE (p:Page {id: $id})
         SET p.url = $url, p.title = $title, p.docSourceId = $docSourceId`,
        { id: pid, url: page.url, title: page.title, docSourceId },
      );
      pageTotal++;

      // Extract entities from this page
      const knowledge = await extractPageKnowledge(page);
      if (knowledge.entities.length === 0) {
        skipped++;
        continue;
      }

      // Batch upsert entities + MENTIONED_IN edges using UNWIND
      const entityParams = knowledge.entities.map((e) => ({
        eid: entityId(docSourceId, e.name),
        name: e.name,
        type: e.type,
      }));
      await runCypher(
        `UNWIND $entities AS ent
         MERGE (e:Entity {id: ent.eid})
         SET e.name = ent.name, e.type = ent.type, e.docSourceId = $docSourceId
         WITH e
         MATCH (p:Page {id: $pid})
         MERGE (e)-[:MENTIONED_IN]->(p)`,
        { entities: entityParams, docSourceId, pid },
      );
      entityTotal += knowledge.entities.length;
      console.log(`[KG] ✓ page "${page.title}" → ${knowledge.entities.length} entities written to Neo4j`);

      // Batch create RELATED_TO edges using UNWIND
      if (knowledge.relationships.length > 0) {
        const relParams = knowledge.relationships.map((rel) => ({
          fromId: entityId(docSourceId, rel.from),
          toId: entityId(docSourceId, rel.to),
          relType: rel.type,
        }));
        await runCypher(
          `UNWIND $rels AS rel
           MATCH (a:Entity {id: rel.fromId}), (b:Entity {id: rel.toId})
           MERGE (a)-[r:RELATED_TO {type: rel.relType}]->(b)`,
          { rels: relParams },
        );
        console.log(`[KG] ✓ page "${page.title}" → ${knowledge.relationships.length} relationships written`);
      }
    } catch (err) {
      // Non-fatal: log and continue with next page
      console.error(`[KG] ✗ Failed to process page "${page.url}":`, err);
    }
  }

  console.log(
    `[KG] Build complete for ${docSourceId}: ${pageTotal} pages processed, ${entityTotal} entities written, ${skipped} pages skipped (no entities extracted)`,
  );
}

/**
 * Remove all KG nodes and edges for a doc source.
 * Only call this before a FULL re-index. For incremental updates use
 * updateKnowledgeGraphPages() which only removes stale pages.
 */
export async function deleteKnowledgeGraph(
  docSourceId: string,
): Promise<void> {
  if (!isNeo4jEnabled()) return;

  await runCypher(
    `MATCH (n {docSourceId: $docSourceId}) DETACH DELETE n`,
    { docSourceId },
  );

  console.log(`[KG] Deleted knowledge graph for ${docSourceId}`);
}

/**
 * Incremental KG update for a set of changed pages.
 * Deletes only the Page nodes (and their Entity relationships) for the given
 * URLs, then re-extracts and re-inserts entities for those pages.
 * All unchanged pages and their entities remain intact — no downtime window.
 */
export async function updateKnowledgeGraphPages(
  docSourceId: string,
  changedPages: Page[],
): Promise<void> {
  if (!isNeo4jEnabled() || changedPages.length === 0) return;

  console.log(
    `[KG] Incremental update for ${docSourceId}: ${changedPages.length} changed pages`,
  );

  // Step 1: Remove stale Page nodes + dangling MENTIONED_IN edges for changed URLs.
  // Entity nodes that are ONLY mentioned in changed pages get detached but are
  // NOT deleted — they may still be referenced by other (unchanged) pages.
  // Orphaned entities (no remaining MENTIONED_IN edges) are cleaned up separately.
  const pageIds = changedPages.map((p) => pageId(p.url));
  await runCypher(
    `UNWIND $pageIds AS pid
     MATCH (p:Page {id: pid, docSourceId: $docSourceId})
     DETACH DELETE p`,
    { pageIds, docSourceId },
  );

  // Step 2: Clean up entities that now have no MENTIONED_IN edges at all.
  await runCypher(
    `MATCH (e:Entity {docSourceId: $docSourceId})
     WHERE NOT (e)-[:MENTIONED_IN]->()
     DETACH DELETE e`,
    { docSourceId },
  );

  // Step 3: Rebuild KG for the changed pages using the standard buildKnowledgeGraph.
  await buildKnowledgeGraph(docSourceId, changedPages);

  console.log(
    `[KG] Incremental update complete for ${docSourceId}: ${changedPages.length} pages refreshed`,
  );
}
