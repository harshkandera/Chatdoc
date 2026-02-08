import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/workspaces/status - Lightweight endpoint for polling status only
// Optional query param: ?ids=id1,id2,id3 to filter specific workspaces
export async function GET(request: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get optional IDs filter from query params
  const idsParam = request.nextUrl.searchParams.get("ids");
  const filterIds = idsParam ? idsParam.split(",").filter(Boolean) : null;

  // Build where clause
  const where = filterIds ? { userId, id: { in: filterIds } } : { userId };

  // Only fetch workspace IDs and DocSource status - minimal data
  const workspaces = await prisma.workspace.findMany({
    where,
    select: {
      id: true,
      DocSource: {
        select: {
          status: true,
          statusMessage: true,
        },
      },
    },
  });

  return NextResponse.json(workspaces);
}
