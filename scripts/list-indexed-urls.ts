/**
 * List all unique page URLs indexed in the database (Postgres Chunk table).
 * These URLs match what is stored in Pinecone vector metadata.
 *
 * Usage:
 *   pnpm tsx scripts/list-indexed-urls.ts
 *   pnpm tsx scripts/list-indexed-urls.ts --docSourceId=<id>
 *   pnpm tsx scripts/list-indexed-urls.ts --json
 */

import "dotenv/config";
import { prisma } from "../lib/db/prisma";

async function main() {
  const args = process.argv.slice(2);
  const docSourceId = args
    .find((a) => a.startsWith("--docSourceId="))
    ?.split("=")[1];
  const asJson = args.includes("--json");

  // Fetch all DocSources for context
  const docSources = await prisma.docSource.findMany({
    where: docSourceId ? { id: docSourceId } : undefined,
    select: { id: true, productName: true, rootUrl: true, chunkCount: true, documentCount: true },
  });

  if (docSources.length === 0) {
    console.error("No DocSources found.");
    process.exit(1);
  }

  const output: Record<
    string,
    { name: string; rootUrl: string; urls: string[] }
  > = {};

  for (const ds of docSources) {
    // Distinct URLs for this DocSource
    const rows = await prisma.chunk.findMany({
      where: { docSourceId: ds.id },
      select: { url: true, title: true },
      distinct: ["url"],
      orderBy: { url: "asc" },
    });

    const urls = rows.map((r) => r.url);
    output[ds.id] = { name: ds.productName, rootUrl: ds.rootUrl, urls };

    if (!asJson) {
      console.log(`\n─── ${ds.productName} (${ds.id}) ───`);
      console.log(`    Root URL : ${ds.rootUrl}`);
      console.log(`    Pages    : ${ds.documentCount ?? "?"} documented, ${urls.length} with chunks`);
      console.log(`    Chunks   : ${ds.chunkCount ?? "?"} total`);
      console.log(`\n    Indexed URLs (${urls.length}):`);
      urls.forEach((url, i) => console.log(`    ${String(i + 1).padStart(4)}. ${url}`));
    }
  }

  if (asJson) {
    console.log(JSON.stringify(output, null, 2));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
