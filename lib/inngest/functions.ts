import { inngest } from "./client";
import {
  scrapeAndStore,
  chunkAndStore,
  embedAndStoreBatch,
  cleanupS3,
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
    const totalBatches = Math.ceil((chunkResult.chunkCount || 0) / EMBED_BATCH_SIZE);
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

// Export all functions for the Inngest serve handler
export const functions = [
  indexDocSourceFunction,
  updateDocSourceStatusFunction,
  globalDocSourceCancelledHandler,
];
