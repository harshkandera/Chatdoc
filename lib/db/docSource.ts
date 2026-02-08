import { prisma } from "@/lib/db/prisma";
import crypto from "crypto";

// Normalize URL to canonical form
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove protocol, www, trailing slashes, query params
    let canonical = parsed.hostname.replace(/^www\./, "");

    // Add first path segment for docs
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      canonical += "/" + pathParts[0];
    }

    return canonical.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// Generate hash for URL (for deduplication)
export function hashUrl(url: string): string {
  return crypto.createHash("md5").update(url).digest("hex").slice(0, 16);
}

// Find existing DocSource or create new one
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

  // Check if DocSource already exists
  const existing = await prisma.docSource.findUnique({
    where: { canonicalUrl },
  });

  if (existing) {
    return { docSource: existing, isNew: false };
  }

  // Create new DocSource
  const docSource = await prisma.docSource.create({
    data: {
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

// Get DocSource by canonical URL
export async function getDocSourceByCanonicalUrl(canonicalUrl: string) {
  return prisma.docSource.findUnique({
    where: { canonicalUrl },
  });
}

// Get DocSource by ID
export async function getDocSourceById(id: string) {
  return prisma.docSource.findUnique({
    where: { id },
  });
}

// Update DocSource status with optional message
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
  // FIX #4: Use transaction for critical status updates
  // Ensures either all updates happen or none do
  return await prisma.$transaction(async (tx) => {
    return tx.docSource.update({
      where: { id },
      data: {
        status,
        statusMessage: options?.message ?? null,
        ...(status === "ready" && {
          lastIndexedAt: new Date(),
          statusMessage: null, // Clear message when ready
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
  });
}

// Find or create Workspace for user and DocSource
export async function findOrCreateWorkspace(
  userId: string,
  docSourceId: string,
  name: string,
) {
  // Check if workspace already exists for this user + docSource
  const existing = await prisma.workspace.findUnique({
    where: {
      userId_docSourceId: { userId, docSourceId },
    },
    include: { DocSource: true },
  });

  if (existing) {
    return { workspace: existing, isNew: false };
  }

  // Create new workspace
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

// Get user's workspaces with DocSource info
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
