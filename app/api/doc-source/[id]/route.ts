import { getDocSourceById } from "@/lib/db/docSource";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const docSource = await getDocSourceById(id);

    if (!docSource) {
      return NextResponse.json(
        { error: "DocSource not found" },
        { status: 404 },
      );
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
