import { auth } from "@clerk/nextjs/server";
import { getDocSourceById } from "@/lib/db/docSource";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const docSource = await getDocSourceById(id);

    if (!docSource) {
      return NextResponse.json(
        { error: "DocSource not found" },
        { status: 404 },
      );
    }

    // Verify the requesting user has a workspace for this DocSource
    // (DocSources are shared — must match BOTH docSourceId AND userId)
    const workspace = await prisma.workspace.findFirst({
      where: { docSourceId: id, userId },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      status: docSource.status,
      statusMessage: docSource.statusMessage,
      documentCount: docSource.documentCount,
      chunkCount: docSource.chunkCount,
    });
  } catch (error) {
    console.error("Error fetching doc source status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
