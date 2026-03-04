import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getDocSourceById } from "@/lib/db/docSource";
import { indexingChannel, type IndexingStatusEvent } from "@/lib/redis";
import Redis from "ioredis";

export const dynamic = "force-dynamic";

function makeRedisSubscriber() {
  return new Redis({
    host: process.env.REDIS_HOST!,
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD,
    lazyConnect: true,
  });
}

function sseEvent(data: IndexingStatusEvent): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  // Verify user has access to this DocSource
  const workspace = await prisma.workspace.findFirst({
    where: { docSourceId: id, userId },
    select: { id: true },
  });
  if (!workspace) {
    return new Response("Forbidden", { status: 403 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // ── Step 1: Send current DB snapshot immediately ──────────────────────
      // This ensures the client is never stuck even if Redis messages were missed.
      try {
        const docSource = await getDocSourceById(id);
        if (docSource) {
          const snapshot: IndexingStatusEvent = {
            status: docSource.status,
            statusMessage: docSource.statusMessage ?? null,
            documentCount: docSource.documentCount ?? null,
            chunkCount: docSource.chunkCount ?? null,
          };
          controller.enqueue(encoder.encode(sseEvent(snapshot)));

          // If already terminal, no need to subscribe
          if (docSource.status === "ready" || docSource.status === "error") {
            controller.close();
            return;
          }
        }
      } catch {
        // DB fetch failed — continue to subscribe anyway
      }

      // ── Step 2: Subscribe to Redis channel for live updates ───────────────
      let subscriber: Redis | null = null;

      try {
        subscriber = makeRedisSubscriber();
        const channel = indexingChannel(id);

        await subscriber.subscribe(channel);

        subscriber.on("message", (_chan: string, message: string) => {
          try {
            const payload = JSON.parse(message) as IndexingStatusEvent;
            controller.enqueue(encoder.encode(sseEvent(payload)));

            // Close SSE when terminal status received
            if (payload.status === "ready" || payload.status === "error") {
              subscriber?.disconnect();
              controller.close();
            }
          } catch {
            // malformed message — ignore
          }
        });

        subscriber.on("error", () => {
          // Redis error — close cleanly, client will fall back to polling
          controller.close();
        });
      } catch {
        // Redis unavailable — close so client falls back to polling
        subscriber?.disconnect();
        controller.close();
        return;
      }

      // ── Step 3: Clean up when client disconnects ──────────────────────────
      req.signal.addEventListener("abort", () => {
        subscriber?.disconnect();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
