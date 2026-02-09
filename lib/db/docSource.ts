import { prisma } from "@/lib/db/prisma";
import crypto from "crypto";

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
          statusMessage: null,
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
