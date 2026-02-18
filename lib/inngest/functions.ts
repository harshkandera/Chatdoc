import { inngest } from "./client";
import {
  scrapeAndStore,
  chunkAndStore,
  embedAndStoreBatch,
  cleanupS3,
  smartScrapeAndStore,
  embedAndStoreBatchWithHash,
} from "@/lib/ai/indexer";
import { updateDocSourceStatus } from "@/lib/db/docSource";

// Batch size for embedding steps (chunks per batch)
const EMBED_BATCH_SIZE = 50;

/* -------------------------------------------------------
   Status Updater (Single Source of Truth)
------------------------------------------------------- */
export const updateDocSourceStatusFunction = inngest.createFunction(
  {
    id: "update-docsource-status",
    concurrency: {
      limit: 1,
      // Keying by ID guarantees that updates for a specific doc happen in order
      key: "event.data.docSourceId",
    },
  },
  { event: "docsource/status.updated" },
  async ({ event, step }) => {
    const { docSourceId, status, message, documentCount, chunkCount } =
      event.data;

    await step.run("persist-docsource-status", async () => {
      await updateDocSourceStatus(docSourceId, status as any, {
        message,
        documentCount,
        chunkCount,
      });
    });
  },
);

/* -------------------------------------------------------
   Global Cancellation Handler
------------------------------------------------------- */
// Handles timeouts and manual cancellations from the dashboard
export const globalDocSourceCancelledHandler = inngest.createFunction(
  { id: "docsource-global-cancel-handler" },
  {
    event: "inngest/function.cancelled",
    // FIX: Use endsWith to ignore the app-id prefix (e.g. "chatdoc-")
    if: "event.data.function_id.endsWith('index-docsource')",
  },
  async ({ event, step }) => {
    // Robust ID Extraction: Check inside the nested system event
    const originalEvent = (event as any).data?.event;
    const docSourceId =
      (event as any).data?.docSourceId || originalEvent?.data?.docSourceId;

    if (!docSourceId) {
      return;
    }

    await step.run("emit-cancellation-status", async () => {
      await inngest.send({
        name: "docsource/status.updated",
        data: {
          docSourceId,
          status: "error",
          message: "Indexing cancelled (timeout or manual)",
        },
      });
    });
  },
);

/* -------------------------------------------------------
   Main Indexing Function (S3-Backed + Batched)
------------------------------------------------------- */
export const indexDocSourceFunction = inngest.createFunction(
  {
    id: "index-docsource",
    retries: 2,
    concurrency: {
      limit: 2,
    },
    cancelOn: [
      {
        event: "docsource/index.cancelled",
        if: "async.data.docSourceId == event.data.docSourceId",
      },
    ],
    onFailure: async ({ event, error }) => {
      console.log("[Inngest] Function failure:", error);

      const originalEvent = (event as any).data?.event;
      const docSourceId =
        (event as any).data?.docSourceId || originalEvent?.data?.docSourceId;

      if (!docSourceId) return;

      // Cleanup S3 on failure
      try {
        await cleanupS3(docSourceId);
      } catch (e) {
        console.error("[Inngest] S3 cleanup on failure failed:", e);
      }

      await inngest.send({
        name: "docsource/status.updated",
        data: {
          docSourceId,
          status: "error",
          message: error?.message || "Indexing failed after retries",
        },
      });
    },
  },
  { event: "docsource/index.requested" },
  async ({ event, step }) => {
    const { docSourceId, productName } = event.data;

    // Step 1: Emit pending status
    await step.run("emit-pending-status", async () => {
      await inngest.send({
        name: "docsource/status.updated",
        data: {
          docSourceId,
          status: "pending",
          message: "Indexing job queued...",
        },
      });
    });

    // Step 2: Emit scraping status
    await step.run("emit-scraping-status", async () => {
      await inngest.send({
        name: "docsource/status.updated",
        data: {
          docSourceId,
          status: "scraping",
          message: "Starting scrape...",
        },
      });
    });

    // Step 3: Scrape all pages → store in S3 (returns only metadata)
    const scrapeResult = await step.run("scrape-and-store", async () => {
      console.log(`[DocSource:${docSourceId}] Scraping and storing to S3...`);
      return await scrapeAndStore(docSourceId);
    });

    // Step 4: Emit chunking status
    await step.run("emit-chunking-status", async () => {
      await inngest.send({
        name: "docsource/status.updated",
        data: {
          docSourceId,
          status: "chunking",
          message: `Chunking ${scrapeResult.pageCount} pages...`,
        },
      });
    });

    // Step 5: Chunk all pages → store in S3 (returns only metadata)
    const chunkResult = await step.run("chunk-and-store", async () => {
      console.log(`[DocSource:${docSourceId}] Chunking and storing to S3...`);
      return await chunkAndStore(docSourceId, scrapeResult.s3Key);
    });

    // Step 6: Emit embedding status
    await step.run("emit-embedding-status", async () => {
      await inngest.send({
        name: "docsource/status.updated",
        data: {
          docSourceId,
          status: "embedding",
          message: `Embedding ${chunkResult.chunkCount} chunks in batches of ${EMBED_BATCH_SIZE}...`,
        },
      });
    });

    // Step 7..N: Embed + store in batches
    const totalBatches = Math.ceil(
      (chunkResult.chunkCount || 0) / EMBED_BATCH_SIZE,
    );
    let totalVectors = 0;

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batchResult = await step.run(
        `embed-batch-${batchIdx}`,
        async () => {
          console.log(
            `[DocSource:${docSourceId}] Embedding batch ${batchIdx + 1}/${totalBatches}...`,
          );

          // Update status for each batch
          await inngest.send({
            name: "docsource/status.updated",
            data: {
              docSourceId,
              status: "embedding",
              message: `Embedding batch ${batchIdx + 1}/${totalBatches}...`,
            },
          });

          return await embedAndStoreBatch(
            docSourceId,
            productName,
            chunkResult.s3Key,
            batchIdx,
            EMBED_BATCH_SIZE,
          );
        },
      );

      totalVectors += batchResult.vectorCount || 0;
    }

    // Step N+1: Cleanup S3
    await step.run("cleanup-s3", async () => {
      console.log(`[DocSource:${docSourceId}] Cleaning up S3...`);
      await cleanupS3(docSourceId);
    });

    // Step N+2: Emit ready status
    await step.run("emit-ready-status", async () => {
      await inngest.send({
        name: "docsource/status.updated",
        data: {
          docSourceId,
          status: "ready",
          documentCount: scrapeResult.pageCount,
          chunkCount: chunkResult.chunkCount,
        },
      });
    });

    console.log(
      `[DocSource:${docSourceId}] Indexing complete! ${scrapeResult.pageCount} pages, ${chunkResult.chunkCount} chunks, ${totalVectors} vectors`,
    );

    return {
      success: true,
      documentCount: scrapeResult.pageCount,
      chunkCount: chunkResult.chunkCount,
      vectorCount: totalVectors,
    };
  },
);

/* -------------------------------------------------------
   Smart Re-Index Function (Hash-Based Incremental)
------------------------------------------------------- */
export const smartReindexDocSourceFunction = inngest.createFunction(
  {
    id: "smart-reindex-docsource",
    retries: 2,
    concurrency: { limit: 2 },
    cancelOn: [
      {
        event: "docsource/index.cancelled",
        if: "async.data.docSourceId == event.data.docSourceId",
      },
    ],
    onFailure: async ({ event, error }) => {
      const originalEvent = (event as any).data?.event;
      const docSourceId =
        (event as any).data?.docSourceId || originalEvent?.data?.docSourceId;
      if (!docSourceId) return;

      try {
        await cleanupS3(docSourceId);
      } catch (e) {
        console.error("[Inngest] S3 cleanup on reindex failure:", e);
      }

      await inngest.send({
        name: "docsource/status.updated",
        data: {
          docSourceId,
          status: "ready", // Go back to ready on failure (data still intact)
          message: `Re-index failed: ${error?.message || "Unknown error"}`,
        },
      });
    },
  },
  { event: "docsource/reindex.requested" },
  async ({ event, step }) => {
    const { docSourceId, productName } = event.data;

    // Step 1: Emit scraping status
    await step.run("emit-reindex-scraping", async () => {
      await inngest.send({
        name: "docsource/status.updated",
        data: {
          docSourceId,
          status: "scraping",
          message: "Smart re-index: scraping for changes...",
        },
      });
    });

    // Step 2: Smart scrape — compare hashes, only store changed pages
    const scrapeResult = await step.run("smart-scrape-and-store", async () => {
      console.log(
        `[DocSource:${docSourceId}] Smart scraping (hash compare)...`,
      );
      return await smartScrapeAndStore(docSourceId);
    });

    // If nothing changed, skip all remaining steps
    if (scrapeResult.changedCount === 0) {
      await step.run("emit-no-changes", async () => {
        await inngest.send({
          name: "docsource/status.updated",
          data: {
            docSourceId,
            status: "ready",
            message: `Re-index complete: no changes detected (${scrapeResult.pageCount} pages checked)`,
          },
        });
      });

      return {
        success: true,
        changedCount: 0,
        unchangedCount: scrapeResult.unchangedCount,
        message: "No changes detected",
      };
    }

    // Step 3: Chunk changed pages
    await step.run("emit-reindex-chunking", async () => {
      await inngest.send({
        name: "docsource/status.updated",
        data: {
          docSourceId,
          status: "chunking",
          message: `Chunking ${scrapeResult.changedCount} changed pages (${scrapeResult.unchangedCount} unchanged, skipped)...`,
        },
      });
    });

    const chunkResult = await step.run("chunk-changed-pages", async () => {
      return await chunkAndStore(docSourceId, scrapeResult.s3Key);
    });

    // Step 4: Embed changed chunks (batched)
    await step.run("emit-reindex-embedding", async () => {
      await inngest.send({
        name: "docsource/status.updated",
        data: {
          docSourceId,
          status: "embedding",
          message: `Embedding ${chunkResult.chunkCount} chunks from changed pages...`,
        },
      });
    });

    const totalBatches = Math.ceil(
      (chunkResult.chunkCount || 0) / EMBED_BATCH_SIZE,
    );
    let totalVectors = 0;

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batchResult = await step.run(
        `reindex-embed-batch-${batchIdx}`,
        async () => {
          await inngest.send({
            name: "docsource/status.updated",
            data: {
              docSourceId,
              status: "embedding",
              message: `Re-index embedding batch ${batchIdx + 1}/${totalBatches}...`,
            },
          });

          return await embedAndStoreBatchWithHash(
            docSourceId,
            productName,
            chunkResult.s3Key,
            batchIdx,
            EMBED_BATCH_SIZE,
          );
        },
      );

      totalVectors += batchResult.vectorCount || 0;
    }

    // Step 5: Cleanup S3
    await step.run("reindex-cleanup-s3", async () => {
      await cleanupS3(docSourceId);
    });

    // Step 6: Update final counts
    await step.run("emit-reindex-ready", async () => {
      // Get updated total counts from DB
      const { _count } = await (
        await import("@/lib/db/prisma")
      ).prisma.chunk.aggregate({
        where: { docSourceId },
        _count: true,
      });

      await inngest.send({
        name: "docsource/status.updated",
        data: {
          docSourceId,
          status: "ready",
          documentCount: scrapeResult.pageCount,
          chunkCount: _count,
          message: `Re-index complete: ${scrapeResult.changedCount} pages updated, ${scrapeResult.unchangedCount} unchanged`,
        },
      });
    });

    return {
      success: true,
      changedCount: scrapeResult.changedCount,
      unchangedCount: scrapeResult.unchangedCount,
      newVectors: totalVectors,
    };
  },
);

/* -------------------------------------------------------
   Auto Re-Index Cron (Pro Only, Monthly)
------------------------------------------------------- */
const AUTO_REINDEX_CRON = process.env.AUTO_REINDEX_CRON || "0 0 1 */1 *"; // 1st of every month at midnight

export const autoReindexCronFunction = inngest.createFunction(
  {
    id: "auto-reindex-cron",
    retries: 1,
  },
  { cron: AUTO_REINDEX_CRON },
  async ({ step }) => {
    // Find all Pro users' doc sources that are ready
    const docSources = await step.run("find-pro-docsources", async () => {
      const { prisma } = await import("@/lib/db/prisma");

      // Get all active Pro users
      const proUsers = await prisma.user.findMany({
        where: { status: "active" },
        select: { id: true },
      });

      if (proUsers.length === 0) return [];

      // Get all ready DocSources owned by Pro users
      const workspaces = await prisma.workspace.findMany({
        where: {
          userId: { in: proUsers.map((u) => u.id) },
          DocSource: { status: "ready" },
        },
        include: {
          DocSource: {
            select: { id: true, productName: true },
          },
        },
      });

      // Deduplicate by docSourceId (multiple workspaces might share the same DocSource)
      const uniqueDocSources = new Map<
        string,
        { id: string; productName: string }
      >();
      for (const ws of workspaces) {
        uniqueDocSources.set(ws.DocSource.id, {
          id: ws.DocSource.id,
          productName: ws.DocSource.productName,
        });
      }

      return Array.from(uniqueDocSources.values());
    });

    if (docSources.length === 0) {
      return { message: "No Pro doc sources to re-index" };
    }

    // Dispatch re-index events for each doc source
    await step.run("dispatch-reindex-events", async () => {
      const events = docSources.map(
        (ds: { id: string; productName: string }) => ({
          name: "docsource/reindex.requested" as const,
          data: {
            docSourceId: ds.id,
            productName: ds.productName,
          },
        }),
      );

      await inngest.send(events);

      // Update lastAutoReindexAt for all doc sources
      const { prisma } = await import("@/lib/db/prisma");
      await prisma.docSource.updateMany({
        where: { id: { in: docSources.map((ds: { id: string }) => ds.id) } },
        data: { lastAutoReindexAt: new Date() },
      });
    });

    return {
      message: `Dispatched re-index for ${docSources.length} Pro doc sources`,
      docSourceIds: docSources.map((ds: { id: string }) => ds.id),
    };
  },
);

/* -------------------------------------------------------
   Index Discovered Pages (from web_search_docs fallback)
   Follows the same S3 + batch embedding pattern as index-docsource.
   Receives already-scraped content, deduplicates, then:
   pages→S3, chunk→S3, embed in batches, cleanup S3.
------------------------------------------------------- */
export const indexDiscoveredPagesFunction = inngest.createFunction(
  {
    id: "index-discovered-pages",
    retries: 1,
    concurrency: { limit: 3 },
  },
  { event: "docsource/pages.discovered" },
  async ({ event, step }) => {
    const { docSourceId, productName, pages } = event.data as {
      docSourceId: string;
      productName: string;
      pages: { url: string; title: string; content: string }[];
    };

    console.log(
      `🔥 [Discovered Pages] Indexing ${pages.length} pages for ${productName} (${docSourceId})`,
    );

    // Step 1: Deduplicate — skip pages already in DB
    const newPages = await step.run("deduplicate-pages", async () => {
      const { prisma } = await import("@/lib/db/prisma");
      const { hashUrl } = await import("@/lib/db/docSource");

      const urlHashes = pages.map((p) => hashUrl(p.url));
      const existing = await prisma.chunk.findMany({
        where: {
          docSourceId,
          urlHash: { in: urlHashes },
        },
        select: { urlHash: true },
        distinct: ["urlHash"],
      });

      const existingHashes = new Set(existing.map((e) => e.urlHash));
      const filtered = pages.filter((p) => !existingHashes.has(hashUrl(p.url)));

      console.log(
        `🔥 [Discovered Pages] ${pages.length} pages → ${filtered.length} new (${existing.length} already indexed)`,
      );

      return filtered;
    });

    if (newPages.length === 0) {
      console.log(`🔥 [Discovered Pages] All pages already indexed, skipping`);
      return { success: true, indexed: 0, skipped: pages.length };
    }

    // Step 2: Store pages to S3 (same pattern as scrapeAndStore)
    const pagesS3Key = await step.run("store-pages-s3", async () => {
      const { uploadJSON, pagesKey } = await import("@/lib/s3");

      // Add empty links array to match the Page type expected by chunkAndStore
      const pagesWithLinks = newPages.map((p) => ({
        ...p,
        links: [],
      }));

      const key = pagesKey(docSourceId);
      await uploadJSON(key, pagesWithLinks);

      console.log(
        `🔥 [Discovered Pages] Stored ${newPages.length} pages to S3 (${key})`,
      );
      return key;
    });

    // Step 3: Chunk pages from S3 → store chunks to S3
    const chunkResult = await step.run("chunk-and-store", async () => {
      console.log(
        `🔥 [Discovered Pages] Chunking ${newPages.length} pages from S3...`,
      );
      return await chunkAndStore(docSourceId, pagesS3Key);
    });

    console.log(
      `🔥 [Discovered Pages] Chunked → ${chunkResult.chunkCount} chunks`,
    );

    // Step 4..N: Embed + store in batches (same pattern as index-docsource)
    const totalBatches = Math.ceil(
      (chunkResult.chunkCount || 0) / EMBED_BATCH_SIZE,
    );
    let totalVectors = 0;

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batchResult = await step.run(
        `embed-batch-${batchIdx}`,
        async () => {
          console.log(
            `🔥 [Discovered Pages] Embedding batch ${batchIdx + 1}/${totalBatches}...`,
          );
          return await embedAndStoreBatch(
            docSourceId,
            productName,
            chunkResult.s3Key,
            batchIdx,
            EMBED_BATCH_SIZE,
          );
        },
      );

      totalVectors += batchResult.vectorCount || 0;
    }

    // Step N+1: Cleanup S3
    await step.run("cleanup-s3", async () => {
      console.log(`🔥 [Discovered Pages] Cleaning up S3...`);
      await cleanupS3(docSourceId);
    });

    // Step N+2: Update chunkCount on DocSource (additive)
    await step.run("update-chunk-count", async () => {
      const { prisma } = await import("@/lib/db/prisma");
      await prisma.docSource.update({
        where: { id: docSourceId },
        data: {
          chunkCount: { increment: chunkResult.chunkCount || 0 },
        },
      });
      console.log(
        `🔥 [Discovered Pages] Updated chunkCount += ${chunkResult.chunkCount}`,
      );
    });

    console.log(
      `🔥 [Discovered Pages] Complete! ${newPages.length} pages, ${chunkResult.chunkCount} chunks, ${totalVectors} vectors`,
    );

    return {
      success: true,
      indexed: newPages.length,
      skipped: pages.length - newPages.length,
      chunks: chunkResult.chunkCount,
      vectors: totalVectors,
    };
  },
);

// Export all functions for the Inngest serve handler
export const functions = [
  indexDocSourceFunction,
  smartReindexDocSourceFunction,
  autoReindexCronFunction,
  updateDocSourceStatusFunction,
  globalDocSourceCancelledHandler,
  indexDiscoveredPagesFunction,
];
