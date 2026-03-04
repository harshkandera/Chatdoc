import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/doc-sources
// Returns all ready DocSources with a flag indicating if the user already has a workspace for each
export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // All ready shared DocSources
  const [docSources, userWorkspaces] = await Promise.all([
    prisma.docSource.findMany({
      where: { status: "ready" },
      select: {
        id: true,
        productName: true,
        rootUrl: true,
        canonicalUrl: true,
        docType: true,
        version: true,
        description: true,
        documentCount: true,
        chunkCount: true,
        lastIndexedAt: true,
        changeStrategy: true,
        _count: { select: { Workspace: true } },
      },
      orderBy: [
        { chunkCount: "desc" }, // most comprehensive first
      ],
    }),
    prisma.workspace.findMany({
      where: { userId },
      select: { docSourceId: true, id: true },
    }),
  ]);

  const userDocSourceIds = new Map(
    userWorkspaces.map((w) => [w.docSourceId, w.id]),
  );

  const result = docSources.map((ds) => ({
    ...ds,
    userWorkspaceId: userDocSourceIds.get(ds.id) ?? null, // null = not added yet
    userCount: ds._count.Workspace,
  }));

  return NextResponse.json(result);
}
