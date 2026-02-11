import { currentUser } from "@clerk/nextjs/server";
import { createChat } from "@/lib/chat/createChat";
import { storeMessage } from "@/lib/chat/storeMessage";
import { prisma } from "@/lib/db/prisma";
import { handleQuery } from "@/lib/ai/query/handler";
import { ModelProvider } from "@/lib/ai/models";
import { ensureUser } from "@/lib/db/user";
import { polar } from "@/lib/polar";

export async function POST(req: Request) {
  const requestStart = Date.now();
  console.log(
    `\n🚀 [${new Date().toISOString()}] ========== CHAT REQUEST START ==========`,
  );

  const user = await currentUser();
  console.log(`⏱️  [+${Date.now() - requestStart}ms] Auth check complete`);

  if (!user || !user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = user.id;

  // JIT Provisioning: Ensure user exists in local DB
  await ensureUser({
    id: userId,
    email: user.emailAddresses[0]?.emailAddress || "",
    name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    imageUrl: user.imageUrl,
  });

  const body = await req.json();

  const { chatId, message, model, provider = "groq", workspaceId } = body;
  console.log(
    `📝 [+${Date.now() - requestStart}ms] Message: "${message.slice(0, 50)}..." | Provider: ${provider}`,
  );

  if (!message) {
    return new Response("Message is required", { status: 400 });
  }

  let activeChatId = chatId;
  let activeWorkspaceId = workspaceId;

  // Create chat if needed
  if (!activeChatId) {
    const chat = await createChat({
      userId,
      title: message.slice(0, 40),
      model,
      provider,
      workspaceId: activeWorkspaceId,
    });
    activeChatId = chat.id;
  } else if (!activeWorkspaceId) {
    // Get workspace from existing chat
    const chat = await prisma.chat.findUnique({
      where: { id: activeChatId },
      select: { workspaceId: true },
    });
    activeWorkspaceId = chat?.workspaceId;
  }

  // Store user message
  console.log(`💾 [+${Date.now() - requestStart}ms] Storing user message...`);
  await storeMessage({
    chatId: activeChatId,
    role: "user",
    content: message,
  });
  console.log(`✅ [+${Date.now() - requestStart}ms] User message stored`);

  // If no workspace, return error (need to select workspace first)

  if (!activeWorkspaceId) {
    return Response.json({
      chatId: activeChatId,
      error:
        "No workspace selected. Please select a documentation workspace first.",
    });
  }

  // Check workspace and DocSource status
  const workspace = await prisma.workspace.findUnique({
    where: { id: activeWorkspaceId },
    include: { DocSource: true },
  });

  if (!workspace || workspace.DocSource.status !== "ready") {
    return Response.json({
      chatId: activeChatId,
      error:
        "Documentation is not ready. Please wait for indexing to complete.",
    });
  }

  try {
    // Get AI response using RAG pipeline
    console.log(
      `\n🤖 [+${Date.now() - requestStart}ms] Starting RAG pipeline...`,
    );
    const startTime = Date.now();

    const result = await handleQuery(message, activeWorkspaceId, {
      provider: provider as ModelProvider,
    });

    const latencyMs = Date.now() - startTime;
    console.log(
      `✅ [+${Date.now() - requestStart}ms] RAG complete in ${latencyMs}ms`,
    );

    // Build response with sources
    let content = result.content;
    if (result.sources.length > 0) {
      content += "\n\n---\n**Sources:**\n";
      result.sources.forEach((source, i) => {
        content += `- [${i + 1}] ${source}\n`;
      });
    }

    // Store assistant message
    console.log(
      `💾 [+${Date.now() - requestStart}ms] Storing assistant response...`,
    );
    await storeMessage({
      chatId: activeChatId,
      role: "assistant",
      content,
      latencyMs,
    });
    console.log(
      `🏁 [+${Date.now() - requestStart}ms] ========== CHAT REQUEST COMPLETE ==========\n`,
    );

    // Ingest meter event to Polar for usage tracking
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { customerId: true },
      });

      if (dbUser?.customerId) {
        await polar.events.ingest({
          events: [
            {
              name: "chat_query",
              externalCustomerId: dbUser.customerId,
              metadata: {
                workspaceId: activeWorkspaceId,
                provider: provider,
                latencyMs: latencyMs.toString(),
              },
            },
          ],
        });
        console.log(
          `📊 [Polar] Meter event ingested for customer ${dbUser.customerId}`,
        );
      }
    } catch (meterError) {
      console.error("[Polar] Failed to ingest meter event:", meterError);
    }

    return Response.json({
      chatId: activeChatId,
      content,
      sources: result.sources,
      confidence: result.confidence,
      wasDecomposed: result.wasDecomposed,
    });
  } catch (error) {
    console.error("Chat error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Failed to generate response";

    return Response.json(
      {
        chatId: activeChatId,
        error: errorMessage,
      },
      { status: 500 },
    );
  }
}
