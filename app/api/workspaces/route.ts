import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db/prisma";
import { NextResponse } from "next/server";
import {
  findOrCreateDocSource,
  findOrCreateWorkspace,
} from "@/lib/db/docSource";
import { inngest } from "@/lib/inngest/client";
import { checkDocLimit } from "@/lib/subscription";

export const dynamic = "force-dynamic";

// GET /api/workspaces - List user's workspaces with chats
export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaces = await prisma.workspace.findMany({
    where: { userId },
    include: {
      DocSource: true,
      Chat: {
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Transform Chat to chats for frontend consistency
  const transformed = workspaces.map((w) => ({
    ...w,
    chats: w.Chat,
  }));

  return NextResponse.json(transformed);
}

// POST /api/workspaces - Create a new workspace
export async function POST(req: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, sourceUrl, productName } = body;

  if (!name || !sourceUrl) {
    return NextResponse.json(
      { error: "name and sourceUrl are required" },
      { status: 400 },
    );
  }

  // Check subscription limits
  const { isReached, limit } = await checkDocLimit(userId);
  if (isReached) {
    return NextResponse.json(
      {
        error: `You have reached the limit of ${limit} document source${limit > 1 ? "s" : ""} for your plan. Please upgrade to add more.`,
      },
      { status: 403 },
    );
  }

  // Validate URL
  try {
    new URL(sourceUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Find or create DocSource (shared across users)
  const { docSource, isNew: isNewDocSource } = await findOrCreateDocSource(
    sourceUrl,
    {
      productName: productName || name,
    },
  );

  // Find or create Workspace for this user + docSource
  const { workspace, isNew: isNewWorkspace } = await findOrCreateWorkspace(
    userId,
    docSource.id,
    name,
  );

  console.log(`[API/Workspaces] Returning response:`, {
    workspaceId: workspace.id,
    docSourceStatus: docSource.status,
    isNewDocSource,
    isNewWorkspace,
  });

  // Auto-start indexing for NEW doc sources OR existing ones still pending
  const shouldTriggerIndexing =
    isNewDocSource || docSource.status === "pending";

  if (shouldTriggerIndexing) {
    console.log(
      `[Workspace] Triggering indexing for DocSource: ${docSource.id} (new: ${isNewDocSource}, status: ${docSource.status})`,
    );
    try {
      // FIX #3: Ensure Inngest event is sent with proper error handling
      const result = await inngest.send({
        name: "docsource/index.requested",
        data: {
          docSourceId: docSource.id,
          productName: docSource.productName,
        },
      });
      console.log(
        `[Workspace] ✅ Inngest event sent for DocSource: ${docSource.id}`,
        result,
      );
    } catch (error) {
      console.error(`[Workspace] ❌ Failed to send Inngest event:`, error);
      // Important: Don't fail workspace creation if Inngest fails
      // The user can trigger indexing again later
      // Status remains "pending" in DB
    }
  } else {
    console.log(
      `[Workspace] DocSource already indexed (${docSource.id}, status: ${docSource.status})`,
    );
  }

  return NextResponse.json(
    {
      workspace,
      docSource,
      isNewDocSource,
      isNewWorkspace,
    },
    { status: isNewWorkspace ? 201 : 200 },
  );
}
