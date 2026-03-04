import { inngest } from "./client";
import { NullableJsonNullValueInput } from "@/app/generated/prisma/internal/prismaNamespace";
import {
  scrapeAndStore,
  chunkAndStore,
  embedAndStoreBatch,
  cleanupS3,
  smartScrapeAndStore,
  embedAndStoreBatchWithHash,
} from "@/lib/ai/indexer";
import {
  updateDocSourceStatus,
  updateDocSourceChangeMetadata,
  getIndexCheckpoint,
  saveIndexCheckpoint,
  clearIndexCheckpoint,
  isCheckpointValid,
  type DocSourceStatus,
} from "@/lib/db/docSource";
import { s3KeyExists, discoveredPrefix, discoveredPagesKey, discoveredChunksKey, kgPagesKey } from "@/lib/s3";

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
      await updateDocSourceStatus(
        docSourceId,
        status as DocSourceStatus,
        {
          message,
          documentCount,
          chunkCount,
        }
      );
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
    type EventDataWithDocSource = {
      data?: { event?: { data?: { docSourceId?: string } }; docSourceId?: string };
    };
    // Robust ID Extraction: Check inside the nested system event
    const eventPayload = event as EventDataWithDocSource;
    const originalEvent = eventPayload.data?.event;
    const docSourceId =
      eventPayload.data?.docSourceId || originalEvent?.data?.docSourceId;

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
    concurrency: [
      { limit: 2 }, // max 2 total indexing jobs at once
      { limit: 1, key: "event.data.docSourceId" }, // max 1 per DocSource (prevents duplicate runs)
    ],
    cancelOn: [
      {
        event: "docsource/index.cancelled",
        if: "async.data.docSourceId == event.data.docSourceId",
      },
    ],
    onFailure: async ({ event, error }) => {
      console.log("[Inngest] Function failure:", error);

      type EventDataWithDocSource = {
        data?: { event?: { data?: { docSourceId?: string } }; docSourceId?: string };
      };
      const eventPayload = event as EventDataWithDocSource;
      const originalEvent = eventPayload.data?.event;
      const docSourceId =
        eventPayload.data?.docSourceId || originalEvent?.data?.docSourceId;

      if (!docSourceId) return;

      // NOTE: We intentionally do NOT clean up S3 here.
      // The checkpoint + S3 data is kept alive so the next run can resume.
      // S3 data expires via lifecycle rule. Checkpoint TTL is enforced on resume.

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
      const cp = await getIndexCheckpoint(docSourceId);
      if (isCheckpointValid(cp) && cp?.jobType === "index" && cp?.pagesS3Key && await s3KeyExists(cp.pagesS3Key)) {
        console.log(`[DocSource:${docSourceId}] Resuming — reusing scraped pages from S3`);
        return { s3Key: cp.pagesS3Key, pageCount: cp.pageCount ?? 0 };
      }
      // Save startedAt + jobType BEFORE the long-running scrape so that:
      // (a) the TTL clock starts even if scraping is interrupted mid-way, and
      // (b) the s3OrphanSweeper recognises this as an active job.
      await saveIndexCheckpoint(docSourceId, {
        jobType: "index",
        startedAt: new Date().toISOString(),
      });
      console.log(`[DocSource:${docSourceId}] Scraping and storing to S3...`);
      const result = await scrapeAndStore(docSourceId);
      await saveIndexCheckpoint(docSourceId, {
        pagesS3Key: result.s3Key,
        pageCount: result.pageCount,
      });
      return result;
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
      const cp = await getIndexCheckpoint(docSourceId);
      if (isCheckpointValid(cp) && cp?.jobType === "index" && cp?.chunksS3Key && await s3KeyExists(cp.chunksS3Key)) {
        console.log(`[DocSource:${docSourceId}] Resuming — reusing chunks from S3`);
        return { s3Key: cp.chunksS3Key, chunkCount: cp.chunkCount ?? 0 };
      }
      console.log(`[DocSource:${docSourceId}] Chunking and storing to S3...`);
      const result = await chunkAndStore(docSourceId, scrapeResult.s3Key);
      await saveIndexCheckpoint(docSourceId, {
        chunksS3Key: result.s3Key,
        chunkCount: result.chunkCount,
      });
      return result;
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
          // Single checkpoint read — reused for both the skip-check and the save,
          // avoiding a stale-read race where two reads return different completedBatches.
          const cp = await getIndexCheckpoint(docSourceId);
          if (isCheckpointValid(cp) && cp?.jobType === "index" && cp?.completedBatches?.includes(batchIdx)) {
            console.log(`[DocSource:${docSourceId}] Resuming — batch ${batchIdx} already done, skipping`);
            return { vectorCount: 0 };
          }

          console.log(
            `[DocSource:${docSourceId}] Embedding batch ${batchIdx + 1}/${totalBatches}...`,
          );

          await inngest.send({
            name: "docsource/status.updated",
            data: {
              docSourceId,
              status: "embedding",
              message: `Embedding batch ${batchIdx + 1}/${totalBatches}...`,
            },
          });

          const result = await embedAndStoreBatch(
            docSourceId,
            productName,
            chunkResult.s3Key,
            batchIdx,
            EMBED_BATCH_SIZE,
          );

          // Write the updated completedBatches array directly to avoid a second
          // internal read inside saveIndexCheckpoint reading stale data.
          const updatedBatches = [...(cp?.completedBatches ?? []), batchIdx];
          await saveIndexCheckpoint(docSourceId, { completedBatches: updatedBatches });

          return result;
        },
      );

      totalVectors += batchResult.vectorCount || 0;
    }

    // Step N+1: Mark ready immediately — user can start chatting with pure RAG now
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

    // Step N+2: Trigger async KG build — non-blocking, user is already chatting.
    // Pages are copied to the kg/ S3 prefix which the cleanup below does NOT touch.
    // The KG function is responsible for deleting that key after it finishes.
    await step.run("trigger-kg-build", async () => {
      const { isNeo4jEnabled } = await import("@/lib/ai/graph/neo4j");
      if (!isNeo4jEnabled()) {
        console.log(`[DocSource:${docSourceId}] Neo4j not configured — skipping KG trigger`);
        return;
      }
      const { downloadJSON, uploadJSON } = await import("@/lib/s3");
      const pages = await downloadJSON<
        { url: string; title: string; content: string; links: string[] }[]
      >(scrapeResult.s3Key);
      const kgKey = kgPagesKey(docSourceId);
      await uploadJSON(kgKey, pages);
      await inngest.send({
        name: "docsource/kg.build.requested",
        data: { docSourceId, pagesS3Key: kgKey, mode: "full" },
      });
      console.log(`[DocSource:${docSourceId}] KG build triggered async (${pages.length} pages → ${kgKey})`);
    });

    // Step N+3: Cleanup S3 + clear checkpoint (kg/ prefix is untouched)
    await step.run("cleanup-s3", async () => {
      console.log(`[DocSource:${docSourceId}] Cleaning up S3...`);
      await cleanupS3(docSourceId);
      await clearIndexCheckpoint(docSourceId);
    });

    // Step N+4: Record first-index as a change (sets banner data)
    await step.run("update-change-metadata", async () => {
      await updateDocSourceChangeMetadata(docSourceId, {
        lastChangeAt: new Date(),
        lastChangeType: "major",
        changeDescription: `${scrapeResult.pageCount} page${scrapeResult.pageCount !== 1 ? "s" : ""} indexed`,
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
    concurrency: [
      { limit: 2 },
      { limit: 1, key: "event.data.docSourceId" },
    ],
    cancelOn: [
      {
        event: "docsource/index.cancelled",
        if: "async.data.docSourceId == event.data.docSourceId",
      },
    ],
    onFailure: async ({ event, error }) => {
      type EventDataWithDocSource = {
        data?: { event?: { data?: { docSourceId?: string } }; docSourceId?: string };
      };
      const eventPayload = event as EventDataWithDocSource;
      const originalEvent = eventPayload.data?.event;
      const docSourceId =
        eventPayload.data?.docSourceId || originalEvent?.data?.docSourceId;
      if (!docSourceId) return;

      // NOTE: S3 data kept alive intentionally — checkpoint allows resume.
      // S3 lifecycle rule expires data after 7 days as a safety net.

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
      const cp = await getIndexCheckpoint(docSourceId);
      if (
        isCheckpointValid(cp) &&
        cp?.jobType === "reindex" &&
        cp?.pagesS3Key &&
        await s3KeyExists(cp.pagesS3Key)
      ) {
        console.log(`[DocSource:${docSourceId}] Resuming reindex — reusing smart-scraped pages from S3`);
        return {
          s3Key: cp.pagesS3Key,
          pageCount: cp.pageCount ?? 0,
          changedCount: cp.changedCount ?? 0,
          unchangedCount: cp.unchangedCount ?? 0,
          failedUrls: [] as string[],
        };
      }
      // Anchor the TTL clock before the long-running scrape
      await saveIndexCheckpoint(docSourceId, {
        jobType: "reindex",
        startedAt: new Date().toISOString(),
      });
      console.log(`[DocSource:${docSourceId}] Smart scraping (hash compare)...`);
      const result = await smartScrapeAndStore(docSourceId);
      await saveIndexCheckpoint(docSourceId, {
        pagesS3Key: result.s3Key,
        pageCount: result.pageCount,
        changedCount: result.changedCount,
        unchangedCount: result.unchangedCount,
      });
      return result;
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
      const cp = await getIndexCheckpoint(docSourceId);
      if (
        isCheckpointValid(cp) &&
        cp?.jobType === "reindex" &&
        cp?.chunksS3Key &&
        await s3KeyExists(cp.chunksS3Key)
      ) {
        console.log(`[DocSource:${docSourceId}] Resuming reindex — reusing chunks from S3`);
        return { s3Key: cp.chunksS3Key, chunkCount: cp.chunkCount ?? 0 };
      }
      const result = await chunkAndStore(docSourceId, scrapeResult.s3Key);
      await saveIndexCheckpoint(docSourceId, {
        chunksS3Key: result.s3Key,
        chunkCount: result.chunkCount,
      });
      return result;
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
          // Single read — reused for skip-check and save to avoid stale completedBatches
          const cp = await getIndexCheckpoint(docSourceId);
          if (
            isCheckpointValid(cp) &&
            cp?.jobType === "reindex" &&
            cp?.completedBatches?.includes(batchIdx)
          ) {
            console.log(`[DocSource:${docSourceId}] Resuming reindex — batch ${batchIdx} already done, skipping`);
            return { vectorCount: 0 };
          }

          await inngest.send({
            name: "docsource/status.updated",
            data: {
              docSourceId,
              status: "embedding",
              message: `Re-index embedding batch ${batchIdx + 1}/${totalBatches}...`,
            },
          });

          const result = await embedAndStoreBatchWithHash(
            docSourceId,
            productName,
            chunkResult.s3Key,
            batchIdx,
            EMBED_BATCH_SIZE,
          );

          const updatedBatches = [...(cp?.completedBatches ?? []), batchIdx];
          await saveIndexCheckpoint(docSourceId, { completedBatches: updatedBatches });

          return result;
        },
      );

      totalVectors += batchResult.vectorCount || 0;
    }

    // Step 5: Mark ready immediately — user can chat while KG updates in background
    await step.run("emit-reindex-ready", async () => {
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

    // Step 6: Trigger async incremental KG update — non-blocking
    await step.run("trigger-kg-rebuild", async () => {
      const { isNeo4jEnabled } = await import("@/lib/ai/graph/neo4j");
      if (!isNeo4jEnabled()) return;
      const { downloadJSON, uploadJSON } = await import("@/lib/s3");
      const pages = await downloadJSON<
        { url: string; title: string; content: string; links: string[] }[]
      >(scrapeResult.s3Key);
      const kgKey = kgPagesKey(docSourceId);
      await uploadJSON(kgKey, pages);
      await inngest.send({
        name: "docsource/kg.build.requested",
        data: { docSourceId, pagesS3Key: kgKey, mode: "incremental" },
      });
      console.log(`[DocSource:${docSourceId}] KG incremental rebuild triggered (${pages.length} changed pages → ${kgKey})`);
    });

    // Step 7: Cleanup S3 + clear checkpoint (kg/ prefix is untouched)
    await step.run("reindex-cleanup-s3", async () => {
      await cleanupS3(docSourceId);
      await clearIndexCheckpoint(docSourceId);
    });

    // Step 8: Record change metadata for banner
    await step.run("update-change-metadata", async () => {
      const changed = scrapeResult.changedCount;
      await updateDocSourceChangeMetadata(docSourceId, {
        lastChangeAt: new Date(),
        lastChangeType: changed > 20 ? "major" : "minor",
        changeDescription: `${changed} page${changed !== 1 ? "s" : ""} updated`,
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
   Auto Re-Index Cron (Pro Only, Strategy-Aware Polling)
------------------------------------------------------- */
const AUTO_REINDEX_CRON = process.env.AUTO_REINDEX_CRON || "0 */6 * * *"; // Every 6 hours

/** Adaptive poll interval based on how recently docs changed.
 *  Accepts Date or ISO string (Inngest serializes Dates to strings). */
function adaptivePollInterval(lastChangeAt: Date | string | null): number {
  if (!lastChangeAt) return 24;
  const daysSince = (Date.now() - new Date(lastChangeAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < 7) return 12;
  if (daysSince < 30) return 24;
  return 72;
}

export const autoReindexCronFunction = inngest.createFunction(
  {
    id: "auto-reindex-cron",
    retries: 1,
  },
  { cron: AUTO_REINDEX_CRON },
  async ({ step }) => {
    const { prisma } = await import("@/lib/db/prisma");
    const now = new Date();

    // Find all Pro users' doc sources that are ready AND due for polling
    const docSources = await step.run("find-due-docsources", async () => {
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
            select: {
              id: true,
              productName: true,
              rootUrl: true,
              changeStrategy: true,
              pollIntervalHours: true,
              lastPollAt: true,
              lastChangeAt: true,
              rssUrl: true,
              sitemapUrl: true,
              pollEtag: true,
              pollContentHash: true,
            },
          },
        },
      });

      // Deduplicate by docSourceId
      const uniqueDocSources = new Map<string, typeof workspaces[0]["DocSource"]>();
      for (const ws of workspaces) {
        uniqueDocSources.set(ws.DocSource.id, ws.DocSource);
      }

      // Filter to only those due for polling
      return Array.from(uniqueDocSources.values()).filter((ds) => {
        if (!ds.lastPollAt) return true; // Never polled → due
        const hoursSince =
          (now.getTime() - ds.lastPollAt.getTime()) / (1000 * 60 * 60);
        return hoursSince >= ds.pollIntervalHours;
      });
    });

    if (docSources.length === 0) {
      return { message: "No doc sources due for polling" };
    }

    const toReindex: { id: string; productName: string }[] = [];
    const { sha256 } = await import("@/lib/ai/indexer/classify");

    for (const ds of docSources) {
      const strategy = ds.changeStrategy || "blind";

      await step.run(`poll-${ds.id}`, async () => {
        // ── RSS strategy ─────────────────────────────────────────────────────
        if (strategy === "rss" && ds.rssUrl) {
          // #1: Send ETag / Last-Modified headers so the server can 304
          const headers: Record<string, string> = {};
          if (ds.pollEtag) headers["If-None-Match"] = ds.pollEtag;

          let changed = false;
          let newEtag: string | null = null;

          try {
            const res = await fetch(ds.rssUrl, { headers });

            if (res.status === 304) {
              // Server confirmed nothing changed — cheapest possible check
            } else if (res.ok) {
              newEtag = res.headers.get("etag");

              const xml = await res.text();
              const dateMatch = xml.match(/<(?:pubDate|updated)>([^<]+)<\/(?:pubDate|updated)>/);
              if (dateMatch) {
                const itemDate = new Date(dateMatch[1]);
                if (!ds.lastPollAt || itemDate > new Date(ds.lastPollAt)) {
                  changed = true;
                }
              }
            }
          } catch {
            // Network error — skip this cycle
          }

          await prisma.docSource.update({
            where: { id: ds.id },
            data: {
              lastPollAt: now,
              ...(newEtag && { pollEtag: newEtag }),
              ...(changed && { pollIntervalHours: adaptivePollInterval(ds.lastChangeAt) }),
            },
          });

          if (changed) toReindex.push({ id: ds.id, productName: ds.productName });
          return;
        }

        // ── Sitemap strategy ─────────────────────────────────────────────────
        if (strategy === "sitemap" && ds.sitemapUrl) {
          // #1: ETag conditional GET
          const headers: Record<string, string> = {};
          if (ds.pollEtag) headers["If-None-Match"] = ds.pollEtag;

          let changed = false;
          let newEtag: string | null = null;

          try {
            const res = await fetch(ds.sitemapUrl, { headers });

            if (res.status === 304) {
              // Nothing changed
            } else if (res.ok) {
              newEtag = res.headers.get("etag");

              const xml = await res.text();
              for (const match of xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) {
                const pageDate = new Date(match[1]);
                if (!ds.lastPollAt || pageDate > new Date(ds.lastPollAt)) {
                  changed = true;
                  break;
                }
              }
            }
          } catch {
            // skip
          }

          await prisma.docSource.update({
            where: { id: ds.id },
            data: {
              lastPollAt: now,
              ...(newEtag && { pollEtag: newEtag }),
              ...(changed && { pollIntervalHours: adaptivePollInterval(ds.lastChangeAt) }),
            },
          });

          if (changed) toReindex.push({ id: ds.id, productName: ds.productName });
          return;
        }

        // ── Blind strategy — SHA-256 content hash ────────────────────────────
        // #2: Fetch key pages, hash the body, compare with stored hash
        const candidates = [
          new URL("/changelog", ds.rootUrl).href,
          new URL("/releases", ds.rootUrl).href,
          ds.rootUrl, // fallback: root page itself
        ];

        let changed = false;
        let newHash: string | null = null;

        for (const url of candidates) {
          try {
            const res = await fetch(url);
            if (res.ok) {
              const body = await res.text();
              newHash = sha256(body);

              if (!ds.pollContentHash) {
                // First time — store hash, don't trigger re-index yet (no baseline to compare)
              } else if (newHash !== ds.pollContentHash) {
                changed = true;
              }
              break; // stop at first successful fetch
            }
          } catch {
            // try next candidate
          }
        }

        await prisma.docSource.update({
          where: { id: ds.id },
          data: {
            lastPollAt: now,
            ...(newHash && { pollContentHash: newHash }),
            ...(changed && { pollIntervalHours: adaptivePollInterval(ds.lastChangeAt) }),
          },
        });

        if (changed) toReindex.push({ id: ds.id, productName: ds.productName });
      });
    }

    if (toReindex.length > 0) {
      await step.run("dispatch-reindex-events", async () => {
        const ids = toReindex.map((ds) => ds.id);

        // Set status to "pending" FIRST so the DB guard in updateDocSourceStatus
        // doesn't block the subsequent scraping/chunking/embedding status updates.
        // (guard blocks updates when status is "ready" or "error")
        await prisma.docSource.updateMany({
          where: { id: { in: ids } },
          data: {
            status: "pending",
            statusMessage: "Auto re-index queued...",
            lastAutoReindexAt: new Date(),
          },
        });

        const events = toReindex.map((ds) => ({
          name: "docsource/reindex.requested" as const,
          data: { docSourceId: ds.id, productName: ds.productName },
        }));
        await inngest.send(events);
      });
    }

    return {
      message: `Polled ${docSources.length} doc sources, dispatched re-index for ${toReindex.length}`,
      reindexed: toReindex.map((ds) => ds.id),
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

    // Step 1: Deduplicate — skip pages already indexed within the last 7 days.
    // Checking indexedAt prevents duplicate jobs from concurrent web searches
    // for the same URL from re-embedding identical content.
    const newPages = await step.run("deduplicate-pages", async () => {
      const { prisma } = await import("@/lib/db/prisma");
      const { hashUrl } = await import("@/lib/db/docSource");

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const urlHashes = pages.map((p) => hashUrl(p.url));
      const existing = await prisma.chunk.findMany({
        where: {
          docSourceId,
          urlHash: { in: urlHashes },
          indexedAt: { gte: sevenDaysAgo },
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

    // Step 2: Store pages to S3 (uses discovered/ prefix to avoid colliding with main pipeline)
    const pagesS3Key = await step.run("store-pages-s3", async () => {
      const { uploadJSON } = await import("@/lib/s3");

      // Add empty links array to match the Page type expected by chunkAndStore
      const pagesWithLinks = newPages.map((p) => ({
        ...p,
        links: [],
      }));

      const key = discoveredPagesKey(docSourceId);
      await uploadJSON(key, pagesWithLinks);

      console.log(
        `🔥 [Discovered Pages] Stored ${newPages.length} pages to S3 (${key})`,
      );
      return key;
    });

    // Step 3: Chunk pages from S3 → store chunks to S3 (under discovered/ prefix)
    const chunkResult = await step.run("chunk-and-store", async () => {
      console.log(
        `🔥 [Discovered Pages] Chunking ${newPages.length} pages from S3...`,
      );
      const { downloadJSON, uploadJSON } = await import("@/lib/s3");
      const { chunkPages } = await import("@/lib/ai/indexer/chunk");

      type Page = { url: string; title: string; content: string; links: string[] };
      const pages = await downloadJSON<Page[]>(pagesS3Key);
      const chunks = await chunkPages(pages);

      const key = discoveredChunksKey(docSourceId);
      await uploadJSON(key, chunks);

      return { chunkCount: chunks.length, s3Key: key };
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

    // Step N+1: Cleanup S3 (only the discovered/ prefix, not the main indexing/ prefix)
    await step.run("cleanup-s3", async () => {
      console.log(`🔥 [Discovered Pages] Cleaning up S3...`);
      const { deletePrefix } = await import("@/lib/s3");
      await deletePrefix(discoveredPrefix(docSourceId));
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

/* -------------------------------------------------------
   S3 Orphan Sweeper (runs daily)
   Cleans up S3 files from indexing jobs that crashed before
   their cleanup step. Finds stale checkpoints (>24h old, not "ready")
   and deletes the associated S3 prefixes.
------------------------------------------------------- */
export const s3OrphanSweeperFunction = inngest.createFunction(
  { id: "s3-orphan-sweeper" },
  { cron: "0 3 * * *" }, // 3am UTC daily
  async ({ step }) => {
    const staleDocSourceIds = await step.run("find-stale-checkpoints", async () => {
      const { prisma } = await import("@/lib/db/prisma");
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // DocSources that are stuck in a non-ready state AND have an old checkpoint
      const stale = await prisma.docSource.findMany({
        where: {
          status: { in: ["scraping", "chunking", "embedding", "error"] },
          indexCheckpoint: { not: undefined },
          updatedAt: { lt: cutoff },
        },
        select: { id: true },
      });
      return stale.map((ds) => ds.id);
    });

    if (staleDocSourceIds.length === 0) {
      console.log(`[S3Sweeper] No stale checkpoints found`);
      return { cleaned: 0 };
    }

    console.log(`[S3Sweeper] Found ${staleDocSourceIds.length} stale checkpoints`);

    let cleaned = 0;
    for (const docSourceId of staleDocSourceIds) {
      await step.run(`sweep-${docSourceId}`, async () => {
        const { deletePrefix } = await import("@/lib/s3");
        const { prisma } = await import("@/lib/db/prisma");

        // Delete both indexing/ and discovered/ prefixes for this docSource
        await Promise.all([
          deletePrefix(`indexing/${docSourceId}/`).catch(() => {}),
          deletePrefix(`discovered/${docSourceId}/`).catch(() => {}),
        ]);

        // Clear the stale checkpoint
        await prisma.docSource.update({
          where: { id: docSourceId },
          data: { indexCheckpoint: NullableJsonNullValueInput.DbNull },
        });

        console.log(`[S3Sweeper] Cleaned orphaned S3 data for ${docSourceId}`);
        cleaned++;
      });
    }

    return { cleaned };
  },
);

/* -------------------------------------------------------
   Background Knowledge Graph Builder
   Triggered by "docsource/kg.build.requested" after the main
   indexing pipeline marks the DocSource as "ready".
   User can already chat (pure RAG) while this runs silently.

   mode "full"        → full rebuild (initial index)
   mode "incremental" → only changed pages (reindex)
------------------------------------------------------- */
export const buildKnowledgeGraphFunction = inngest.createFunction(
  {
    id: "build-knowledge-graph",
    retries: 1, // one retry is enough — KG is best-effort
    concurrency: { limit: 1, key: "event.data.docSourceId" },
    // No onFailure: if it fails, RAG still works perfectly without KG
  },
  { event: "docsource/kg.build.requested" },
  async ({ event, step }) => {
    const { docSourceId, pagesS3Key, mode } = event.data as {
      docSourceId: string;
      pagesS3Key: string;
      mode: "full" | "incremental";
    };

    await step.run("run-kg-build", async () => {
      const { isNeo4jEnabled, setupNeo4jConstraints, runCypher } =
        await import("@/lib/ai/graph/neo4j");

      if (!isNeo4jEnabled()) {
        console.log(`[KG:${docSourceId}] Neo4j not configured — skipping`);
        return;
      }

      const { downloadJSON, deleteKey } = await import("@/lib/s3");
      const { buildKnowledgeGraph, updateKnowledgeGraphPages } =
        await import("@/lib/ai/graph/kg-builder");

      // Ensure uniqueness constraints exist (idempotent — safe every run)
      await setupNeo4jConstraints();

      type KGPage = { url: string; title: string; content: string; links: string[] };
      let pages: KGPage[];
      try {
        pages = await downloadJSON<KGPage[]>(pagesS3Key);
      } catch (err) {
        console.error(`[KG:${docSourceId}] Failed to download pages from S3 (${pagesS3Key}):`, err);
        return;
      }

      console.log(`[KG:${docSourceId}] Starting ${mode} build — ${pages.length} pages`);

      if (mode === "incremental") {
        // Only update nodes for changed pages; unchanged pages stay intact
        await updateKnowledgeGraphPages(docSourceId, pages);
      } else {
        // Full rebuild: remove stale nodes first, then upsert all pages
        const currentUrls = pages.map((p) => p.url);
        await runCypher(
          `MATCH (p:Page {docSourceId: $docSourceId})
           WHERE NOT p.url IN $currentUrls
           DETACH DELETE p`,
          { docSourceId, currentUrls },
        );
        await runCypher(
          `MATCH (e:Entity {docSourceId: $docSourceId})
           WHERE NOT (e)-[:MENTIONED_IN]->()
           DETACH DELETE e`,
          { docSourceId },
        );
        await buildKnowledgeGraph(docSourceId, pages);
      }

      // Delete the temporary kg/ S3 key — no longer needed
      await deleteKey(pagesS3Key).catch((err) =>
        console.warn(`[KG:${docSourceId}] Could not delete S3 key ${pagesS3Key}:`, err),
      );

      console.log(`[KG:${docSourceId}] Build complete (mode=${mode})`);
    });
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
  s3OrphanSweeperFunction,
  buildKnowledgeGraphFunction,
];
