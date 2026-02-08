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

// Index DocSource function with individual steps for retry/resume
export const indexDocSourceFunction = inngest.createFunction(
  {
    id: "index-docsource",
    retries: 3,
    concurrency: {
      limit: 2,
    },
  },
  { event: "docsource/index.requested" },
  async ({ event, step }) => {
    const { docSourceId, productName } = event.data;

    try {
      // Update status BEFORE step (visible during polling)
      await updateDocSourceStatus(docSourceId, "scraping", {
        message: "Starting scrape...",
      });

      // Step 1: Scrape all pages (auto-retries on failure)
      const pages = await step.run("scrape-pages", async () => {
        console.log(`[DocSource:${docSourceId}] Starting scrape...`);
        return await scrapeDocSource(docSourceId);
      });

      // Update status between steps
      await updateDocSourceStatus(docSourceId, "chunking", {
        message: `Chunking ${pages.length} pages...`,
      });

      // Step 2: Chunk content
      const chunks = await step.run("chunk-content", async () => {
        console.log(
          `[DocSource:${docSourceId}] Chunking ${pages.length} pages...`,
        );
        const pagesTyped = pages as unknown as Page[];
        return await chunkDocSource(docSourceId, pagesTyped);
      });

      // Update status between steps
      await updateDocSourceStatus(docSourceId, "embedding", {
        message: `Generating embeddings for ${chunks.length} chunks...`,
      });

      // Step 3: Generate embeddings
      const embeddingResult = await step.run(
        "generate-embeddings",
        async () => {
          console.log(
            `[DocSource:${docSourceId}] Embedding ${chunks.length} chunks...`,
          );
          const chunksTyped = chunks as unknown as ChunkWithMetadata[];
          return await embedDocSource(docSourceId, productName, chunksTyped);
        },
      );

      // Update status between steps
      await updateDocSourceStatus(docSourceId, "storing", {
        message: `Storing ${embeddingResult.vectors.length} vectors...`,
      });

      // Step 4: Store in Pinecone + Postgres
      await step.run("store-data", async () => {
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
      });

      // Ensure "ready" status is visible (in case transaction didn't propagate immediately)
      await updateDocSourceStatus(docSourceId, "ready", {
        documentCount: pages.length,
        chunkCount: chunks.length,
      });

      console.log(`[DocSource:${docSourceId}] Indexing complete!`);

      return {
        success: true,
        documentCount: pages.length,
        chunkCount: chunks.length,
      };
    } catch (error) {
      // On final failure (after all retries), set status to error
      console.error(`[DocSource:${docSourceId}] Indexing failed:`, error);

      // FIX #2: Use step.run with guaranteed DB update for error state
      // This ensures the error status is persisted even if job retries
      await step.run("set-error-status", async () => {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        try {
          await updateDocSourceStatus(docSourceId, "error", {
            message: errorMsg,
          });
          console.log(
            `[DocSource:${docSourceId}] ✅ Error status persisted to DB`,
          );
        } catch (dbError) {
          console.error(
            `[DocSource:${docSourceId}] ❌ Failed to update error status in DB:`,
            dbError,
          );
          // Don't throw - let the main error be thrown below
        }
      });

      throw error; // Re-throw so Inngest marks as failed
    }
  },
);

// Export all functions for the Inngest serve handler
export const functions = [indexDocSourceFunction];
