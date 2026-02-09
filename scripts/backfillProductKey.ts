import { prisma } from "../lib/db/prisma";

function normalizeProductKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\.(com|io|sh|ai|dev)$/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

async function run() {
  const sources = await prisma.docSource.findMany({
    where: { productKey: null },
  });

  console.log(`Found ${sources.length} sources to backfill...`);

  for (const source of sources) {
    const productKey = normalizeProductKey(source.productName);
    console.log(`Backfilling ${source.productName} -> ${productKey}`);

    await prisma.docSource.update({
      where: { id: source.id },
      data: { productKey },
    });
  }

  console.log(`✅ Backfilled ${sources.length} DocSources`);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
