import { prisma } from "@/lib/db/prisma";
import { NullableJsonNullValueInput } from "@/app/generated/prisma/internal/prismaNamespace";
import crypto from "crypto";
import { publishIndexingStatus } from "@/lib/redis";

/* -------------------------------------------------------
   Resumable Indexing Checkpoint
------------------------------------------------------- */

export type IndexCheckpoint = {
  jobType?: "index" | "reindex";
  pagesS3Key?: string;
  pageCount?: number;
  chunksS3Key?: string;
  chunkCount?: number;
  completedBatches?: number[];
  kgBuilt?: boolean; // true once build-knowledge-graph step completes
  // reindex-specific
  changedCount?: number;
  unchangedCount?: number;
  startedAt?: string;
};

const CHECKPOINT_TTL_HOURS = Number(
  process.env.INDEXING_CHECKPOINT_TTL_HOURS ?? 24,
);

export function isCheckpointValid(cp: IndexCheckpoint | null): boolean {
  if (!cp?.startedAt) return false;
  const ageHours =
    (Date.now() - new Date(cp.startedAt).getTime()) / (1000 * 60 * 60);
  return ageHours < CHECKPOINT_TTL_HOURS;
}

export async function getIndexCheckpoint(
  docSourceId: string,
): Promise<IndexCheckpoint | null> {
  const ds = await prisma.docSource.findUnique({
    where: { id: docSourceId },
    select: { indexCheckpoint: true },
  });
  return (ds?.indexCheckpoint as IndexCheckpoint) ?? null;
}

export async function saveIndexCheckpoint(
  docSourceId: string,
  patch: Partial<IndexCheckpoint>,
) {
  const cp = await getIndexCheckpoint(docSourceId);
  await prisma.docSource.update({
    where: { id: docSourceId },
    data: { indexCheckpoint: { ...(cp ?? {}), ...patch } },
  });
}

export async function clearIndexCheckpoint(docSourceId: string) {
  await prisma.docSource.update({
    where: { id: docSourceId },
    data: { indexCheckpoint: NullableJsonNullValueInput.DbNull },
  });
}

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */

const DOC_PATH_HINTS = ["docs", "doc", "documentation", "developer", "api"];

// Normalize product name into stable key
export function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

// Normalize URL into canonical form
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    let canonical = parsed.hostname.replace(/^www\./, "");

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0 && DOC_PATH_HINTS.includes(pathParts[0])) {
      canonical += "/" + pathParts[0];
    }

    return canonical.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// Generate hash (optional but useful)
export function hashUrl(url: string): string {
  return crypto.createHash("md5").update(url).digest("hex").slice(0, 16);
}

/* -------------------------------------------------------
   DocSource
------------------------------------------------------- */

export async function findOrCreateDocSource(
  rootUrl: string,
  metadata: {
    productName: string;
    docType?: string;
    version?: string;
    description?: string;
  },
) {
  const canonicalUrl = normalizeUrl(rootUrl);
  const productKey = normalizeProductName(metadata.productName);

  // 1️⃣ STRONGEST MATCH — same product
  const byProduct = await prisma.docSource.findFirst({
    where: { productKey },
  });

  if (byProduct) {
    return { docSource: byProduct, isNew: false };
  }

  // 2️⃣ Exact canonical URL match
  const exact = await prisma.docSource.findUnique({
    where: { canonicalUrl },
  });

  if (exact) {
    return { docSource: exact, isNew: false };
  }

  // 3️⃣ Related URL match (prefix logic)
  let hostname = "";
  try {
    hostname = new URL(rootUrl).hostname.replace(/^www\./, "");
  } catch {}

  const candidates = await prisma.docSource.findMany({
    where: {
      canonicalUrl: {
        startsWith: hostname,
      },
    },
  });

  const related = candidates.find(
    (c) =>
      canonicalUrl.startsWith(c.canonicalUrl) ||
      c.canonicalUrl.startsWith(canonicalUrl),
  );

  if (related) {
    return { docSource: related, isNew: false };
  }

  // 4️⃣ Create new DocSource
  const docSource = await prisma.docSource.create({
    data: {
      productKey,
      canonicalUrl,
      rootUrl,
      productName: metadata.productName,
      docType: metadata.docType || "guide",
      version: metadata.version,
      description: metadata.description,
      status: "pending",
    },
  });

  return { docSource, isNew: true };
}

/* -------------------------------------------------------
   Getters
------------------------------------------------------- */

export async function getDocSourceByCanonicalUrl(canonicalUrl: string) {
  return prisma.docSource.findUnique({
    where: { canonicalUrl },
  });
}

export async function getDocSourceById(id: string) {
  return prisma.docSource.findUnique({
    where: { id },
  });
}

/* -------------------------------------------------------
   Status Updates
------------------------------------------------------- */

export type DocSourceStatus =
  | "pending"
  | "scraping"
  | "chunking"
  | "embedding"
  | "storing"
  | "ready"
  | "error";

export async function updateDocSourceStatus(
  id: string,
  status: DocSourceStatus,
  options?: {
    message?: string;
    documentCount?: number;
    chunkCount?: number;
  },
) {
  return prisma.$transaction(async (tx) => {
    const isRestart = status === "pending";

    await tx.docSource.updateMany({
      where: {
        id,
        ...(isRestart
          ? {}
          : {
              status: {
                notIn: ["ready", "error"],
              },
            }),
      },
      data: {
        status,
        statusMessage: options?.message ?? null,
        ...(status === "ready" && {
          lastIndexedAt: new Date(),
          // intentionally NOT clearing statusMessage here —
          // callers pass the completion message (e.g. "Re-index complete: 5 pages updated")
        }),
        ...(status === "error" &&
          options?.message && {
            statusMessage: `Error: ${options.message}`,
          }),
        ...(options?.documentCount !== undefined && {
          documentCount: options.documentCount,
        }),
        ...(options?.chunkCount !== undefined && {
          chunkCount: options.chunkCount,
        }),
      },
    });

    return tx.docSource.findUnique({ where: { id } });
  }).then(async (updated) => {
    // Publish to Redis Pub/Sub after DB commit — non-blocking
    if (updated) {
      await publishIndexingStatus(id, {
        status: updated.status,
        statusMessage: updated.statusMessage ?? null,
        documentCount: updated.documentCount ?? null,
        chunkCount: updated.chunkCount ?? null,
      });
    }
    return updated;
  });
}

/* -------------------------------------------------------
   Workspace
------------------------------------------------------- */

export async function findOrCreateWorkspace(
  userId: string,
  docSourceId: string,
  name: string,
) {
  const existing = await prisma.workspace.findUnique({
    where: {
      userId_docSourceId: { userId, docSourceId },
    },
    include: { DocSource: true },
  });

  if (existing) {
    return { workspace: existing, isNew: false };
  }

  const workspace = await prisma.workspace.create({
    data: {
      userId,
      docSourceId,
      name,
    },
    include: { DocSource: true },
  });

  return { workspace, isNew: true };
}

export async function getUserWorkspaces(userId: string) {
  return prisma.workspace.findMany({
    where: { userId },
    include: {
      DocSource: true,
      _count: { select: { Chat: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/* -------------------------------------------------------
   Classification & Change Metadata
------------------------------------------------------- */

export async function updateDocSourceClassification(
  id: string,
  data: {
    changeStrategy: string;
    rssUrl?: string | null;
    sitemapUrl?: string | null;
    pollIntervalHours: number;
    version?: string | null;
  },
) {
  return prisma.docSource.update({
    where: { id },
    data: {
      changeStrategy: data.changeStrategy,
      rssUrl: data.rssUrl ?? null,
      sitemapUrl: data.sitemapUrl ?? null,
      pollIntervalHours: data.pollIntervalHours,
      ...(data.version !== undefined && { version: data.version }),
    },
  });
}

export async function updateDocSourceChangeMetadata(
  id: string,
  data: {
    lastChangeAt: Date;
    lastChangeType: string;
    changeDescription: string;
  },
) {
  return prisma.docSource.update({
    where: { id },
    data: {
      lastChangeAt: data.lastChangeAt,
      lastChangeType: data.lastChangeType,
      changeDescription: data.changeDescription,
    },
  });
}
