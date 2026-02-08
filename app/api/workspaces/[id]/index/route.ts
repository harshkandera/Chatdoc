import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db/prisma";
import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { updateDocSourceStatus } from "@/lib/db/docSource";

// POST /api/workspaces/[id]/index - Start indexing a workspace's DocSource
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

  // Check if DocSource is already ready (no re-indexing needed)
  if (docSource.status === "ready") {
    return NextResponse.json({
      message: "Documentation already indexed",
      workspaceId: workspace.id,
      docSourceId: docSource.id,
      status: "ready",
    });
  }

  // Check if already indexing (any indexing-related status)
  const indexingStatuses = ["scraping", "chunking", "embedding", "storing"];
  if (indexingStatuses.includes(docSource.status)) {
    return NextResponse.json(
      { error: "Indexing already in progress" },
      { status: 409 },
    );
  }

  try {
    // Send event to Inngest FIRST (before changing status)
    // If Inngest fails, we won't change the status
    await inngest.send({
      name: "docsource/index.requested",
      data: {
        docSourceId: docSource.id,
        productName: docSource.productName,
      },
    });

    // Only update status AFTER successful event send
    await updateDocSourceStatus(docSource.id, "pending", {
      message: "Queued for indexing...",
    });

    return NextResponse.json({
      message: "Indexing started",
      workspaceId: workspace.id,
      docSourceId: docSource.id,
    });
  } catch (error) {
    console.error("Failed to start indexing:", error);

    // Ensure status is reset if anything failed
    await updateDocSourceStatus(docSource.id, "pending");

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
          documentCount: true,
          chunkCount: true,
          lastIndexedAt: true,
          productName: true,
        },
      },
    },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  return NextResponse.json({
    workspaceId: workspace.id,
    ...workspace.DocSource,
  });
}
