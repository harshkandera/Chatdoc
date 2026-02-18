import { prisma } from "@/lib/db/prisma";
import { scrapePage, scrapePages } from "./scrape";
import { chunkPages, ChunkWithMetadata } from "./chunk";
import { generateEmbeddings } from "../embeddings";
import { hashUrl, updateDocSourceStatus } from "@/lib/db/docSource";
import { nanoid } from "nanoid";
import { upsertVectors, ChunkMetadata } from "../pinecone";
import {
  uploadJSON,
  downloadJSON,
  deletePrefix,
  indexingPrefix,
  pagesKey,
  chunksKey,
} from "@/lib/s3";

export interface IndexProgress {
  stage: "scraping" | "chunking" | "embedding" | "storing" | "complete";
  current: number;
  total: number;
  message: string;
}

export type ProgressCallback = (progress: IndexProgress) => void;

// Step 1: Scrape all pages from a doc source
export async function scrapeDocSource(
  docSourceId: string,
): Promise<{ url: string; title: string; content: string; links: string[] }[]> {
  const docSource = await prisma.docSource.findUnique({
    where: { id: docSourceId },
  });

  if (!docSource) {
    throw new Error("DocSource not found");
  }

  // Update status
  await updateDocSourceStatus(docSourceId, "scraping", {
    message: "Starting scrape...",
  });

  // Scrape main page to get all doc links
  const mainPage = await scrapePage(docSource.rootUrl);
  const allLinks = [docSource.rootUrl, ...mainPage.links];
  const uniqueLinks = [...new Set(allLinks)].slice(0, 100); // Limit to 100 pages

  await updateDocSourceStatus(docSourceId, "scraping", {
    message: `Found ${uniqueLinks.length} pages`,
  });

  // Scrape all pages with progress updates
  const pages = await scrapePages(uniqueLinks, async (current, total) => {
    // Update status every 5 pages to avoid too many DB writes
    if (current % 5 === 0 || current === total) {
      await updateDocSourceStatus(docSourceId, "scraping", {
        message: `Scraping ${current}/${total} pages`,
      });
    }
  });

  return pages;
}

// Step 2: Chunk all scraped content
export async function chunkDocSource(
  docSourceId: string,
  pages: { url: string; title: string; content: string }[],
): Promise<ChunkWithMetadata[]> {
  await updateDocSourceStatus(docSourceId, "chunking", {
    message: `Processing ${pages.length} pages...`,
  });

  const chunks = await chunkPages(pages);

  await updateDocSourceStatus(docSourceId, "chunking", {
    message: `Created ${chunks.length} chunks`,
  });

  return chunks;
}

// Step 3: Generate embeddings for all chunks
export async function embedDocSource(
  docSourceId: string,
  productName: string,
  chunks: ChunkWithMetadata[],
): Promise<{
  vectors: { id: string; values: number[]; metadata: ChunkMetadata }[];
  chunkRecords: {
    id: string;
    docSourceId: string;
    content: string;
    url: string;
    urlHash: string;
    title: string;
    section: string;
    chunkIndex: number;
    headings: string;
    hasCode: boolean;
    codeLanguages: string[];
    wordCount: number;
    vectorId: string;
    indexedAt: Date;
  }[];
}> {
  const batchSize = 100;
  const indexedAt = new Date();
  const indexedAtStr = indexedAt.toISOString();

  const allVectors: {
    id: string;
    values: number[];
    metadata: ChunkMetadata;
  }[] = [];
  const allChunkRecords: {
    id: string;
    docSourceId: string;
    content: string;
    url: string;
    urlHash: string;
    title: string;
    section: string;
    chunkIndex: number;
    headings: string;
    hasCode: boolean;
    codeLanguages: string[];
    wordCount: number;
    vectorId: string;
    indexedAt: Date;
  }[] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);

    // Update status
    await updateDocSourceStatus(docSourceId, "embedding", {
      message: `Embedding ${i}/${chunks.length} chunks`,
    });

    const embeddings = await generateEmbeddings(batch.map((c) => c.content));

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      const vectorId = nanoid();
      const chunkId = nanoid();
      const urlHash = hashUrl(chunk.metadata.url);

      allVectors.push({
        id: vectorId,
        values: embeddings[j],
        metadata: {
          docSourceId,
          content: chunk.content,
          url: chunk.metadata.url,
          urlHash,
          title: chunk.metadata.title,
          section: chunk.metadata.section || "General",
          chunkIndex: chunk.index,
          productName,
          indexedAt: indexedAtStr,
        },
      });

      allChunkRecords.push({
        id: chunkId,
        docSourceId,
        content: chunk.content,
        url: chunk.metadata.url,
        urlHash,
        title: chunk.metadata.title,
        section: chunk.metadata.section || "General",
        chunkIndex: chunk.index,
        headings: chunk.metadata.headings || "",
        hasCode: chunk.metadata.hasCode,
        codeLanguages: chunk.metadata.codeLanguages,
        wordCount: chunk.metadata.wordCount,
        vectorId,
        indexedAt,
      });
    }
  }

  await updateDocSourceStatus(docSourceId, "embedding", {
    message: `Generated ${allVectors.length} embeddings`,
  });

  return { vectors: allVectors, chunkRecords: allChunkRecords };
}

// Step 4: Store vectors and chunks
export async function storeDocSource(
  docSourceId: string,
  vectors: { id: string; values: number[]; metadata: ChunkMetadata }[],
  chunkRecords: {
    id: string;
    docSourceId: string;
    content: string;
    url: string;
    urlHash: string;
    title: string;
    section: string;
    chunkIndex: number;
    headings: string;
    hasCode: boolean;
    codeLanguages: string[];
    wordCount: number;
    vectorId: string;
    indexedAt: Date;
  }[],
  pageCount: number,
): Promise<void> {
  const batchSize = 100;

  // Store vectors in Pinecone
  await updateDocSourceStatus(docSourceId, "storing", {
    message: "Storing vectors in Pinecone...",
  });

  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = vectors.slice(i, i + batchSize);
    await upsertVectors(batch);

    if (i % 200 === 0 || i + batch.length === vectors.length) {
      await updateDocSourceStatus(docSourceId, "storing", {
        message: `Stored ${i + batch.length}/${vectors.length} vectors`,
      });
    }
  }

  // Store chunks in Postgres with transaction
  await updateDocSourceStatus(docSourceId, "storing", {
    message: "Saving to database...",
  });

  await prisma.$transaction(async (tx) => {
    await tx.chunk.createMany({
      data: chunkRecords,
    });

    await tx.docSource.update({
      where: { id: docSourceId },
      data: {
        status: "ready",
        statusMessage: null,
        lastIndexedAt: new Date(),
        documentCount: pageCount,
        chunkCount: chunkRecords.length,
      },
    });
  });
}

// Legacy: Full indexing function (for backwards compatibility)
export async function indexDocSource(
  docSourceId: string,
  productName: string,
  onProgress?: ProgressCallback,
): Promise<{
  success: boolean;
  documentCount: number;
  chunkCount: number;
  error?: string;
}> {
  try {
    // Step 1: Scrape
    onProgress?.({
      stage: "scraping",
      current: 0,
      total: 1,
      message: "Starting...",
    });
    const pages = await scrapeDocSource(docSourceId);

    // Step 2: Chunk
    onProgress?.({
      stage: "chunking",
      current: 0,
      total: pages.length,
      message: "Chunking...",
    });
    const chunks = await chunkDocSource(docSourceId, pages);

    // Step 3: Embed
    onProgress?.({
      stage: "embedding",
      current: 0,
      total: chunks.length,
      message: "Embedding...",
    });
    const { vectors, chunkRecords } = await embedDocSource(
      docSourceId,
      productName,
      chunks,
    );

    // Step 4: Store
    onProgress?.({
      stage: "storing",
      current: 0,
      total: vectors.length,
      message: "Storing...",
    });
    await storeDocSource(docSourceId, vectors, chunkRecords, pages.length);

    onProgress?.({
      stage: "complete",
      current: vectors.length,
      total: vectors.length,
      message: "Done!",
    });

    return {
      success: true,
      documentCount: pages.length,
      chunkCount: chunks.length,
    };
  } catch (error) {
    console.error("Indexing error:", error);
    await updateDocSourceStatus(docSourceId, "error", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      success: false,
      documentCount: 0,
      chunkCount: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Re-index function
export { deleteDocSourceVectors } from "../pinecone";

export async function reindexDocSource(
  docSourceId: string,
  productName: string,
  onProgress?: ProgressCallback,
) {
  const { deleteDocSourceVectors } = await import("../pinecone");

  await deleteDocSourceVectors(docSourceId);
  await prisma.chunk.deleteMany({ where: { docSourceId } });

  return indexDocSource(docSourceId, productName, onProgress);
}

/* -------------------------------------------------------
   S3-Backed Pipeline Functions (for Inngest)
   Each function stores/retrieves intermediate data via S3
   and returns only small metadata to stay under step limits.
------------------------------------------------------- */

type Page = { url: string; title: string; content: string; links: string[] };

/**
 * Step 1: Scrape all pages and store them in S3.
 * Returns only metadata (pageCount + s3Key).
 */
export async function scrapeAndStore(
  docSourceId: string,
): Promise<{ pageCount: number; s3Key: string }> {
  const docSource = await prisma.docSource.findUnique({
    where: { id: docSourceId },
  });

  if (!docSource) throw new Error("DocSource not found");

  // Scrape main page to get all doc links
  const mainPage = await scrapePage(docSource.rootUrl);
  const allLinks = [docSource.rootUrl, ...mainPage.links];
  const uniqueLinks = [...new Set(allLinks)].slice(0, 100);

  // Scrape all pages
  const pages = await scrapePages(uniqueLinks);

  // Store in S3
  const key = pagesKey(docSourceId);
  await uploadJSON(key, pages);

  return { pageCount: pages.length, s3Key: key };
}

/**
 * Step 2: Fetch pages from S3, chunk them, store chunks in S3.
 * Returns only metadata (chunkCount + s3Key).
 */
export async function chunkAndStore(
  docSourceId: string,
  pageS3Key: string,
): Promise<{ chunkCount: number; s3Key: string }> {
  // Download pages from S3
  const pages = await downloadJSON<Page[]>(pageS3Key);

  // Chunk all pages
  const chunks = await chunkPages(pages);

  // Store chunks in S3
  const key = chunksKey(docSourceId);
  await uploadJSON(key, chunks);

  return { chunkCount: chunks.length, s3Key: key };
}

/**
 * Step 3: Process a batch of chunks — embed and store directly to Pinecone + Postgres.
 * Returns only the count of vectors stored.
 */
export async function embedAndStoreBatch(
  docSourceId: string,
  productName: string,
  chunkS3Key: string,
  batchIndex: number,
  batchSize: number,
): Promise<{ vectorCount: number; isLastBatch: boolean }> {
  // Download all chunks from S3
  const allChunks = await downloadJSON<ChunkWithMetadata[]>(chunkS3Key);

  // Slice the batch
  const start = batchIndex * batchSize;
  const end = Math.min(start + batchSize, allChunks.length);
  const batch = allChunks.slice(start, end);
  const isLastBatch = end >= allChunks.length;

  if (batch.length === 0) {
    return { vectorCount: 0, isLastBatch: true };
  }

  const indexedAt = new Date();
  const indexedAtStr = indexedAt.toISOString();

  // Generate embeddings
  const embeddings = await generateEmbeddings(batch.map((c) => c.content));

  const vectors: { id: string; values: number[]; metadata: ChunkMetadata }[] =
    [];
  const chunkRecords: {
    id: string;
    docSourceId: string;
    content: string;
    url: string;
    urlHash: string;
    title: string;
    section: string;
    chunkIndex: number;
    headings: string;
    hasCode: boolean;
    codeLanguages: string[];
    wordCount: number;
    vectorId: string;
    indexedAt: Date;
  }[] = [];

  for (let j = 0; j < batch.length; j++) {
    const chunk = batch[j];
    const vectorId = nanoid();
    const chunkId = nanoid();
    const urlHash = hashUrl(chunk.metadata.url);

    vectors.push({
      id: vectorId,
      values: embeddings[j],
      metadata: {
        docSourceId,
        content: chunk.content,
        url: chunk.metadata.url,
        urlHash,
        title: chunk.metadata.title,
        section: chunk.metadata.section || "General",
        chunkIndex: chunk.index,
        productName,
        indexedAt: indexedAtStr,
      },
    });

    chunkRecords.push({
      id: chunkId,
      docSourceId,
      content: chunk.content,
      url: chunk.metadata.url,
      urlHash,
      title: chunk.metadata.title,
      section: chunk.metadata.section || "General",
      chunkIndex: chunk.index,
      headings: chunk.metadata.headings || "",
      hasCode: chunk.metadata.hasCode,
      codeLanguages: chunk.metadata.codeLanguages,
      wordCount: chunk.metadata.wordCount,
      vectorId,
      indexedAt,
    });
  }

  // Store vectors in Pinecone (batch of 100)
  for (let i = 0; i < vectors.length; i += 100) {
    await upsertVectors(vectors.slice(i, i + 100));
  }

  // Store chunk records in Postgres
  await prisma.chunk.createMany({ data: chunkRecords });

  return { vectorCount: vectors.length, isLastBatch };
}

/**
 * Cleanup: Remove all temporary S3 objects for a docSource.
 */
export async function cleanupS3(docSourceId: string): Promise<void> {
  await deletePrefix(indexingPrefix(docSourceId));
}

/**
 * Smart Re-Index: Scrape all pages, compare content hashes, and only
 * re-process pages that actually changed. Returns metadata about the diff.
 */
export async function smartScrapeAndStore(docSourceId: string): Promise<{
  pageCount: number;
  changedCount: number;
  unchangedCount: number;
  s3Key: string;
  failedUrls: string[];
}> {
  const { createHash } = await import("crypto");

  const docSource = await prisma.docSource.findUnique({
    where: { id: docSourceId },
  });

  if (!docSource) throw new Error("DocSource not found");

  // Get existing content hashes from DB (grouped by URL)
  const existingChunks = await prisma.chunk.findMany({
    where: { docSourceId },
    select: { url: true, contentHash: true, vectorId: true },
  });

  // Build a map of URL → { hashes, vectorIds } for existing data
  const existingByUrl = new Map<
    string,
    { hashes: Set<string>; vectorIds: string[] }
  >();
  for (const chunk of existingChunks) {
    const entry = existingByUrl.get(chunk.url) || {
      hashes: new Set<string>(),
      vectorIds: [],
    };
    if (chunk.contentHash) entry.hashes.add(chunk.contentHash);
    entry.vectorIds.push(chunk.vectorId);
    existingByUrl.set(chunk.url, entry);
  }

  // Scrape main page to get all doc links
  const mainPage = await scrapePage(docSource.rootUrl);
  const allLinks = [docSource.rootUrl, ...mainPage.links];
  const uniqueLinks = [...new Set(allLinks)].slice(0, 100);

  // Scrape all pages
  const allPages = await scrapePages(uniqueLinks);
  const failedUrls = uniqueLinks.filter(
    (url) => !allPages.some((p) => p.url === url),
  );

  // Compare hashes to find changed pages
  const changedPages: Page[] = [];
  let unchangedCount = 0;

  for (const page of allPages) {
    const contentHash = createHash("sha256").update(page.content).digest("hex");
    const existing = existingByUrl.get(page.url);

    if (existing && existing.hashes.has(contentHash)) {
      // Content unchanged — skip
      unchangedCount++;
    } else {
      // Content changed or new page — needs re-processing
      changedPages.push(page);

      // Delete old vectors + chunks for this URL if they exist
      if (existing) {
        // Delete Pinecone vectors by ID
        const { pineconeIndex } = await import("../pinecone");
        if (existing.vectorIds.length > 0) {
          await pineconeIndex.deleteMany(existing.vectorIds);
        }
        // Delete old chunks from DB
        await prisma.chunk.deleteMany({
          where: { docSourceId, url: page.url },
        });
      }
    }
  }

  // Store changed pages in S3 (only these need re-embedding)
  const key = pagesKey(docSourceId);
  await uploadJSON(key, changedPages);

  // Update DocSource with failed URLs
  await prisma.docSource.update({
    where: { id: docSourceId },
    data: { failedUrls },
  });

  return {
    pageCount: allPages.length,
    changedCount: changedPages.length,
    unchangedCount,
    s3Key: key,
    failedUrls,
  };
}

/**
 * Enhanced embedAndStoreBatch that includes contentHash for smart re-indexing.
 */
export async function embedAndStoreBatchWithHash(
  docSourceId: string,
  productName: string,
  chunkS3Key: string,
  batchIndex: number,
  batchSize: number,
): Promise<{ vectorCount: number; isLastBatch: boolean }> {
  const { createHash } = await import("crypto");

  // Download all chunks from S3
  const allChunks = await downloadJSON<ChunkWithMetadata[]>(chunkS3Key);

  // Slice the batch
  const start = batchIndex * batchSize;
  const end = Math.min(start + batchSize, allChunks.length);
  const batch = allChunks.slice(start, end);
  const isLastBatch = end >= allChunks.length;

  if (batch.length === 0) {
    return { vectorCount: 0, isLastBatch: true };
  }

  const indexedAt = new Date();
  const indexedAtStr = indexedAt.toISOString();

  // Generate embeddings
  const embeddings = await generateEmbeddings(batch.map((c) => c.content));

  const vectors: { id: string; values: number[]; metadata: ChunkMetadata }[] =
    [];
  const chunkRecords: {
    id: string;
    docSourceId: string;
    content: string;
    url: string;
    urlHash: string;
    title: string;
    section: string;
    chunkIndex: number;
    headings: string;
    hasCode: boolean;
    codeLanguages: string[];
    wordCount: number;
    vectorId: string;
    indexedAt: Date;
    contentHash: string;
  }[] = [];

  for (let j = 0; j < batch.length; j++) {
    const chunk = batch[j];
    const vectorId = nanoid();
    const chunkId = nanoid();
    const urlHash = hashUrl(chunk.metadata.url);
    const contentHash = createHash("sha256")
      .update(chunk.content)
      .digest("hex");

    vectors.push({
      id: vectorId,
      values: embeddings[j],
      metadata: {
        docSourceId,
        content: chunk.content,
        url: chunk.metadata.url,
        urlHash,
        title: chunk.metadata.title,
        section: chunk.metadata.section || "General",
        chunkIndex: chunk.index,
        productName,
        indexedAt: indexedAtStr,
      },
    });

    chunkRecords.push({
      id: chunkId,
      docSourceId,
      content: chunk.content,
      url: chunk.metadata.url,
      urlHash,
      title: chunk.metadata.title,
      section: chunk.metadata.section || "General",
      chunkIndex: chunk.index,
      headings: chunk.metadata.headings || "",
      hasCode: chunk.metadata.hasCode,
      codeLanguages: chunk.metadata.codeLanguages,
      wordCount: chunk.metadata.wordCount,
      vectorId,
      indexedAt,
      contentHash,
    });
  }

  // Store vectors in Pinecone (batch of 100)
  for (let i = 0; i < vectors.length; i += 100) {
    await upsertVectors(vectors.slice(i, i + 100));
  }

  // Store chunk records in Postgres
  await prisma.chunk.createMany({ data: chunkRecords });

  return { vectorCount: vectors.length, isLastBatch };
}
