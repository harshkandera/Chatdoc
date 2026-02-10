import { inngest } from "./client";
import {
  scrapeDocSource,
  chunkDocSource,
  embedDocSource,
  storeDocSource,
} from "@/lib/ai/indexer";
import { updateDocSourceStatus } from "@/lib/db/docSource";
import { ChunkWithMetadata } from "@/lib/ai/indexer/chunk";
import { ChunkMetadata } from "@/lib/ai/pinecone";

// Type for pages after serialization
type Page = { url: string; title: string; content: string; links: string[] };

// Type for chunk records
type ChunkRecord = {
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
};

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
    // console.log("🚫 Cancellation Handler Triggered:", JSON.stringify(event));

    // Robust ID Extraction: Check inside the nested system event
    const originalEvent = (event as any).data?.event;
    const docSourceId =
      (event as any).data?.docSourceId || originalEvent?.data?.docSourceId;

    if (!docSourceId) {
      // console.error("❌ CRITICAL: Could not find docSourceId in cancellation event");
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
   Main Indexing Function
------------------------------------------------------- */
export const indexDocSourceFunction = inngest.createFunction(
  {
    id: "index-docsource",
    retries: 2,
    concurrency: {
      limit: 2,
    },
    // Local failure handler: runs immediately when retries are exhausted
    cancelOn: [
      {
        event: "docsource/index.cancelled",
        if: "async.data.docSourceId == event.data.docSourceId",
      },
    ],
    onFailure: async ({ event, error }) => {
      // const docSourceId = (event as any).data?.docSourceId;

      console.log(
        "-----------------------  INNGEST FUNCTION FAILURE--------------  ",
      );

      console.log("-----------------------  EVENT--------------  ", event);

      console.log("-----------------------  ERROR--------------  ", error);

      const originalEvent = (event as any).data?.event;
      const docSourceId =
        (event as any).data?.docSourceId || originalEvent?.data?.docSourceId;

      if (!docSourceId) return;

      // Send to the status updater
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

    try {
      // Emit queued/pending status immediately
      await step.run("emit-queued-status", async () => {
        await inngest.send({
          name: "docsource/status.updated",
          data: {
            docSourceId,
            status: "pending",
            message: "Indexing job queued...",
          },
        });
      });

      // Start - Emit "scraping" event
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

      // Step 1: Scrape all pages (auto-retries on failure)
      const pages = await step.run("scrape-pages", async () => {
        try {
          console.log(`[DocSource:${docSourceId}] Starting scrape...`);
          return await scrapeDocSource(docSourceId);
        } catch (error) {
          console.error(`[DocSource:${docSourceId}] Scrape failed:`, error);
          throw error; // Let Inngest retry
        }
      });

      // Emit "chunking" event
      await step.run("emit-chunking-status", async () => {
        await inngest.send({
          name: "docsource/status.updated",
          data: {
            docSourceId,
            status: "chunking",
            message: `Chunking ${pages.length} pages...`,
          },
        });
      });

      // Step 2: Chunk content
      const chunks = await step.run("chunk-content", async () => {
        try {
          console.log(
            `[DocSource:${docSourceId}] Chunking ${pages.length} pages...`,
          );
          const pagesTyped = pages as unknown as Page[];
          return await chunkDocSource(docSourceId, pagesTyped);
        } catch (error) {
          console.error(`[DocSource:${docSourceId}] Chunking failed:`, error);
          throw error; // Let Inngest retry
        }
      });

      // Emit "embedding" event
      await step.run("emit-embedding-status", async () => {
        await inngest.send({
          name: "docsource/status.updated",
          data: {
            docSourceId,
            status: "embedding",
            message: `Generating embeddings for ${chunks.length} chunks...`,
          },
        });
      });

      // Step 3: Generate embeddings
      const embeddingResult = await step.run(
        "generate-embeddings",
        async () => {
          try {
            console.log(
              `[DocSource:${docSourceId}] Embedding ${chunks.length} chunks...`,
            );
            const chunksTyped = chunks as unknown as ChunkWithMetadata[];
            return await embedDocSource(docSourceId, productName, chunksTyped);
          } catch (error) {
            console.error(
              `[DocSource:${docSourceId}] Embedding failed:`,
              error,
            );
            throw error; // Let Inngest retry
          }
        },
      );

      // Emit "storing" event
      await step.run("emit-storing-status", async () => {
        await inngest.send({
          name: "docsource/status.updated",
          data: {
            docSourceId,
            status: "storing",
            message: `Storing ${embeddingResult.vectors.length} vectors...`,
          },
        });
      });

      // Step 4: Store in Pinecone + Postgres
      await step.run("store-data", async () => {
        try {
          console.log(
            `[DocSource:${docSourceId}] Storing ${embeddingResult.vectors.length} vectors...`,
          );
          const vectors = embeddingResult.vectors as unknown as {
            id: string;
            values: number[];
            metadata: ChunkMetadata;
          }[];
          const chunkRecords =
            embeddingResult.chunkRecords as unknown as ChunkRecord[];
          const chunkRecordsWithDates = chunkRecords.map((r) => ({
            ...r,
            indexedAt: new Date(r.indexedAt as unknown as string),
          }));
          await storeDocSource(
            docSourceId,
            vectors,
            chunkRecordsWithDates,
            pages.length,
          );
        } catch (error) {
          console.error(`[DocSource:${docSourceId}] Storing failed:`, error);
          throw error; // Let Inngest retry
        }
      });

      // Emit "ready" event
      await step.run("emit-ready-status", async () => {
        await inngest.send({
          name: "docsource/status.updated",
          data: {
            docSourceId,
            status: "ready",
            documentCount: pages.length,
            chunkCount: chunks.length,
          },
        });
      });

      console.log(`[DocSource:${docSourceId}] Indexing complete!`);

      return {
        success: true,
        documentCount: pages.length,
        chunkCount: chunks.length,
      };
    } catch (error) {
      // On final failure (after all retries), Inngest will call onFailure
      // We must throw here so Inngest knows it failed.
      console.error(`[DocSource:${docSourceId}] Indexing failed:`, error);
      throw error;
    }
  },
);

// Export all functions for the Inngest serve handler
export const functions = [
  indexDocSourceFunction,
  updateDocSourceStatusFunction,
  globalDocSourceCancelledHandler,
];
