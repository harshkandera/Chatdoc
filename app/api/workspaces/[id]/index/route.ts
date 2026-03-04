import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db/prisma";
import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import {
  updateDocSourceStatus,
  updateDocSourceClassification,
} from "@/lib/db/docSource";
import { checkReindexLimit, incrementReindexCount } from "@/lib/reindex-limit";

// POST /api/workspaces/[id]/index - Start indexing or re-indexing a workspace's DocSource
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    include: { DocSource: true },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (workspace.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const docSource = workspace.DocSource;

  // Check if already indexing (any indexing-related status)
  const indexingStatuses = [
    "scraping",
    "chunking",
    "embedding",
    "storing",
    "pending",
  ];
  if (indexingStatuses.includes(docSource.status)) {
    return NextResponse.json(
      { error: "Indexing already in progress" },
      { status: 409 },
    );
  }

  // Determine if this is a re-index (docs already ready) or first-time index
  const isReindex = docSource.status === "ready";

  // If re-indexing, check the user's monthly limit
  if (isReindex) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const limitCheck = await checkReindexLimit(user.id);
    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          error: "Re-index limit reached",
          used: limitCheck.used,
          limit: limitCheck.limit,
          isPro: limitCheck.isPro,
          resetsAt: limitCheck.resetsAt.toISOString(),
        },
        { status: 429 },
      );
    }
  }

  // Run classification to detect change strategy (non-blocking on error)
  try {
    const { classifyDocSource } = await import("@/lib/ai/indexer/classify");
    const classification = await classifyDocSource(docSource.rootUrl);
    await updateDocSourceClassification(docSource.id, classification);
  } catch (classifyError) {
    console.warn("[classify] Failed to classify DocSource:", classifyError);
  }

  try {
    if (isReindex) {
      // Smart re-index: compare hashes, only re-embed changed pages
      await inngest.send({
        name: "docsource/reindex.requested",
        data: {
          docSourceId: docSource.id,
          productName: docSource.productName,
        },
      });

      // Increment the user's re-index count
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        await incrementReindexCount(user.id);
      }

      await updateDocSourceStatus(docSource.id, "pending", {
        message: "Re-index queued (smart incremental)...",
      });

      return NextResponse.json({
        message: "Smart re-index started",
        workspaceId: workspace.id,
        docSourceId: docSource.id,
        type: "reindex",
      });
    } else {
      // First-time index
      await inngest.send({
        name: "docsource/index.requested",
        data: {
          docSourceId: docSource.id,
          productName: docSource.productName,
        },
      });

      await updateDocSourceStatus(docSource.id, "pending", {
        message: "Queued for indexing...",
      });

      return NextResponse.json({
        message: "Indexing started",
        workspaceId: workspace.id,
        docSourceId: docSource.id,
        type: "index",
      });
    }
  } catch (error) {
    console.error("Failed to start indexing:", error);

    // Reset status on failure
    await updateDocSourceStatus(docSource.id, isReindex ? "ready" : "pending");

    return NextResponse.json(
      { error: "Failed to start indexing. Please try again." },
      { status: 500 },
    );
  }
}

// GET /api/workspaces/[id]/index - Get indexing status
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    include: {
      DocSource: {
        select: {
          id: true,
          status: true,
          statusMessage: true,
          documentCount: true,
          chunkCount: true,
          lastIndexedAt: true,
          productName: true,
          failedUrls: true,
          lastAutoReindexAt: true,
        },
      },
    },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // Ownership check — authenticated users could previously read any workspace's status (#9 fix)
  if (workspace.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Also get the user's re-index limit status
  const user = await prisma.user.findUnique({ where: { id: userId } });
  let reindexLimit = null;
  if (user) {
    reindexLimit = await checkReindexLimit(user.id);
  }

  return NextResponse.json({
    workspaceId: workspace.id,
    ...workspace.DocSource,
    reindexLimit,
  });
}
