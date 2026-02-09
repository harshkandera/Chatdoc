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

// Update DocSource Status function (Event-Driven)
export const updateDocSourceStatusFunction = inngest.createFunction(
  { id: "update-docsource-status" },
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

// Index DocSource function with individual steps for retry/resume
export const indexDocSourceFunction = inngest.createFunction(
  {
    id: "index-docsource",
    retries: 3,
    concurrency: {
      limit: 2,
    },
    onFailure: async ({ event, error }) => {
      const docSourceId = (event as any).data?.docSourceId;
      if (!docSourceId) {
        console.error(
          `[DocSource:Unknown] Failed after retries (no docSourceId):`,
          error,
        );
        return;
      }
      console.error(`[DocSource:${docSourceId}] Failed after retries:`, error);

      // Emit failure event instead of direct DB write
      await inngest.send({
        name: "docsource/status.updated",
        data: {
          docSourceId,
          status: "error",
          message: error.message || "Unknown error after retries",
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
            status: "pending", // Use "pending" for DB consistency, message clarifies "queued"
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
          await inngest.send({
            name: "docsource/status.updated",
            data: {
              docSourceId,
              status: "scraping",
              message: `Scraping failed, retrying... ${(error as Error).message}`,
            },
          });
          throw error;
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
          await inngest.send({
            name: "docsource/status.updated",
            data: {
              docSourceId,
              status: "chunking",
              message: `Chunking failed, retrying... ${(error as Error).message}`,
            },
          });
          throw error;
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
            await inngest.send({
              name: "docsource/status.updated",
              data: {
                docSourceId,
                status: "embedding",
                message: `Embedding failed, retrying... ${(error as Error).message}`,
              },
            });
            throw error;
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
          await inngest.send({
            name: "docsource/status.updated",
            data: {
              docSourceId,
              status: "storing",
              message: `Storing failed, retrying... ${(error as Error).message}`,
            },
          });
          throw error;
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
      // On final failure (after all retries), set status to error
      console.error(`[DocSource:${docSourceId}] Indexing failed:`, error);
      // Let Inngest handle retries for standard errors
      throw error;
    }
  },
);

// Export all functions for the Inngest serve handler
export const functions = [
  indexDocSourceFunction,
  updateDocSourceStatusFunction,
];
