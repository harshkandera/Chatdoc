import { currentUser } from "@clerk/nextjs/server";
import { createChat } from "@/lib/chat/createChat";
import { storeMessage } from "@/lib/chat/storeMessage";
import { prisma } from "@/lib/db/prisma";
import { searchContext, checkEscalation } from "@/lib/ai/query/handler";
import type { ModelProvider } from "@/lib/ai/models";
import { getModelOption } from "@/lib/ai/model-options";
import { ensureUser } from "@/lib/db/user";
import { polar } from "@/lib/polar";
import { streamText, convertToModelMessages } from "ai";
import { getAIModel } from "@/lib/ai/providers";
import { ANSWER_SYSTEM_PROMPT_TEXT } from "@/lib/ai/query/generate";
import { traceable } from "langsmith/traceable";

export const maxDuration = 60;

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

  await ensureUser({
    id: userId,
    email: user.emailAddresses[0]?.emailAddress || "",
    name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    imageUrl: user.imageUrl,
  });

  const body = await req.json();

  const {
    messages: chatMessages,
    message: legacyMessage,
    chatId,
    modelOptionId,
    provider: rawProvider,
    modelId: rawModelId,
    workspaceId,
  } = body;

  const modelOption = modelOptionId ? getModelOption(modelOptionId) : null;
  const provider: ModelProvider =
    modelOption?.provider || rawProvider || "groq";
  const modelId: string | undefined =
    modelOption?.modelId || rawModelId || undefined;

  // Extract latest user message text
  let messageText: string;
  if (chatMessages && chatMessages.length > 0) {
    const lastMsg = chatMessages[chatMessages.length - 1];
    messageText =
      lastMsg.parts?.find(
        (p: { type: string; text?: string }) => p.type === "text",
      )?.text ||
      lastMsg.content ||
      "";
  } else {
    messageText = legacyMessage || "";
  }

  console.log(
    `📝 [+${Date.now() - requestStart}ms] Message: "${messageText.slice(0, 50)}..." | Provider: ${provider}`,
  );

  if (!messageText) {
    return new Response("Message is required", { status: 400 });
  }

  let activeChatId = chatId;
  let activeWorkspaceId = workspaceId;

  if (!activeChatId) {
    const chat = await createChat({
      userId,
      title: messageText.slice(0, 40),
      model: modelId,
      provider,
      workspaceId: activeWorkspaceId,
    });
    activeChatId = chat.id;
  } else if (!activeWorkspaceId) {
    const chat = await prisma.chat.findUnique({
      where: { id: activeChatId },
      select: { workspaceId: true },
    });
    activeWorkspaceId = chat?.workspaceId;
  }

  console.log(`💾 [+${Date.now() - requestStart}ms] Storing user message...`);
  await storeMessage({
    chatId: activeChatId,
    role: "user",
    content: messageText,
  });
  console.log(`✅ [+${Date.now() - requestStart}ms] User message stored`);

  if (!activeWorkspaceId) {
    return new Response(
      "No workspace selected. Please select a documentation workspace first.",
      { status: 400 },
    );
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: activeWorkspaceId },
    include: { DocSource: true },
  });

  if (!workspace || workspace.DocSource.status !== "ready") {
    return new Response(
      "Documentation is not ready. Please wait for indexing to complete.",
      { status: 400 },
    );
  }

  // ── Step 1: RAG Search (synchronous — get context chunks) ──
  console.log(`🔍 [+${Date.now() - requestStart}ms] Running RAG search...`);

  // Groq has a strict 6k-8k input token limit on free tier (or 12k TPM)
  // We must be conservative with context window
  const isGroq = provider === "groq";
  const safeTopK = isGroq ? 2 : 5;

  // ── Wrap the RAG + stream pipeline in a LangSmith root span ──
  // Everything inside this traceable becomes child spans of "chat-request".
  // Auth, message parsing, and DB writes stay outside to keep traces clean.
  const runPipeline = traceable(
    async () => {
      let search;
      try {
        search = await searchContext(messageText, activeWorkspaceId!, {
          provider,
          modelId,
          topK: safeTopK,
        });
      } catch (error) {
        console.error("RAG search failed:", error);
        throw error;
      }

      console.log(
        `✅ [+${Date.now() - requestStart}ms] RAG search complete: ${search.chunks.length} chunks, confidence=${search.confidence}`,
      );

      // ── Step 2: Check if agent escalation is needed ──
      let systemPrompt = search.systemPrompt;

      if (search.confidence === "low" && search.chunks.length < 2) {
        console.log(
          `🔄 [+${Date.now() - requestStart}ms] Low confidence — checking escalation...`,
        );
        const escalation = await checkEscalation(
          messageText,
          activeWorkspaceId!,
          search,
        );
        if (escalation) {
          console.log(
            `🧪 [+${Date.now() - requestStart}ms] Agent provided answer (${escalation.answer.length} chars)`,
          );
          systemPrompt = `${ANSWER_SYSTEM_PROMPT_TEXT}

The following answer was generated by a deep research agent that searched web documentation.
Use it as your primary source and rephrase it clearly for the user.
Cite sources where provided.

Agent Research Result:
${escalation.answer}

Sources:
${escalation.sources.map((s, i) => `[${i + 1}] ${s}`).join("\n")}`;
        }
      }

      // ── Step 3: Stream answer using AI SDK streamText ──
      console.log(
        `🧠 [+${Date.now() - requestStart}ms] Streaming answer with ${provider}/${modelId || "default"}...`,
      );

      // Convert UIMessages from useChat to CoreMessages for streamText.
      // SLIDING WINDOW: Only send the last 6 messages (3 user + 3 assistant turns)
      let coreMessages: Parameters<typeof streamText>[0]["messages"];
      if (chatMessages && chatMessages.length > 0) {
        try {
          const MAX_HISTORY_MESSAGES = 6;
          const windowedMessages =
            chatMessages.length > MAX_HISTORY_MESSAGES
              ? chatMessages.slice(-MAX_HISTORY_MESSAGES)
              : chatMessages;
          console.log(
            `📜 [history] Sending ${windowedMessages.length}/${chatMessages.length} messages (sliding window)`,
          );
          coreMessages = await convertToModelMessages(windowedMessages);
        } catch {
          coreMessages = [{ role: "user" as const, content: messageText }];
        }
      } else {
        coreMessages = [{ role: "user" as const, content: messageText }];
      }

      const MAX_SYSTEM_PROMPT_CHARS = 13000;
      if (systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
        console.warn(
          `⚠️ System prompt too long (${systemPrompt.length} chars). Truncating to ${MAX_SYSTEM_PROMPT_CHARS}...`,
        );
        systemPrompt =
          systemPrompt.slice(0, MAX_SYSTEM_PROMPT_CHARS) + "...[truncated]";
      }

      return streamText({
        model: getAIModel(provider, modelId),
        system: systemPrompt,
        messages: coreMessages,
        experimental_telemetry: {
          isEnabled: true,
          functionId: "stream-answer",
          metadata: {
            chatId: activeChatId,
            workspaceId: activeWorkspaceId,
            provider,
            confidence: search.confidence,
          },
        },
        onError: ({ error }) => {
          console.error(
            `❌ [+${Date.now() - requestStart}ms] streamText error:`,
            error,
          );
        },
        onFinish: async ({ text }) => {
          await storeMessage({
            chatId: activeChatId,
            role: "assistant",
            content: text,
          });
          console.log(
            `🏁 [+${Date.now() - requestStart}ms] ========== CHAT REQUEST COMPLETE ==========\n`,
          );
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
                      workspaceId: activeWorkspaceId || "",
                      provider,
                    },
                  },
                ],
              });
            }
          } catch (meterError) {
            console.error("[Polar] Failed to ingest meter event:", meterError);
          }
        },
      });
    },
    {
      name: "chat-request",
      run_type: "chain",
      metadata: {
        provider,
        modelId,
        chatId: activeChatId,
        workspaceId: activeWorkspaceId,
      },
    },
  );

  let result;
  try {
    result = await runPipeline();
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Failed to search documentation",
      { status: 500 },
    );
  }

  return result.toUIMessageStreamResponse({
    sendStart: true,
    headers: { "X-Chat-Id": activeChatId },
  });
}
