import { currentUser } from "@clerk/nextjs/server";
import { createChat } from "@/lib/chat/createChat";
import { storeMessage } from "@/lib/chat/storeMessage";
import { prisma } from "@/lib/db/prisma";
import { searchContext, checkEscalation } from "@/lib/ai/query/handler";
import type { ModelProvider } from "@/lib/ai/models";
import { getModelOption } from "@/lib/ai/model-options";
import { ensureUser } from "@/lib/db/user";
import { getUserSubscription } from "@/lib/subscription";
import { polar } from "@/lib/polar";
import * as ai from "ai";
import { getAIModel } from "@/lib/ai/providers";
import { ANSWER_SYSTEM_PROMPT_TEXT } from "@/lib/ai/query/generate";
import { gradeContextSufficiency } from "@/lib/ai/graph/grader";
import { traceable } from "langsmith/traceable";
import { wrapAISDK } from "langsmith/experimental/vercel";

const wrappedAi = wrapAISDK(ai);
const { streamText } = wrappedAi;
const {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} = ai;

export const maxDuration = 60;

// ── Casual / greeting detection ──
// Skip the full RAG pipeline for simple messages that don't need documentation.
const CASUAL_PATTERNS = /^\s*(hi|hello|hey|howdy|yo|sup|thanks|thank you|ok|okay|cool|great|bye|goodbye|good morning|good evening|good night|gm|gn|what's up|whats up|how are you|hru|lol|haha|nice|👋|🙏)\s*[.!?]*\s*$/i;

function isCasualMessage(text: string): boolean {
  return CASUAL_PATTERNS.test(text.trim());
}

// ── Shared helper: convert chatMessages to CoreMessages with sliding window ──
type CoreMessages = Awaited<ReturnType<typeof convertToModelMessages>>;

async function buildCoreMessages(
  chatMessages: Array<Record<string, unknown>> | undefined,
  messageText: string,
): Promise<CoreMessages> {
  const MAX_HISTORY_MESSAGES = 6;
  if (chatMessages && chatMessages.length > 0) {
    try {
      const windowed =
        chatMessages.length > MAX_HISTORY_MESSAGES
          ? chatMessages.slice(-MAX_HISTORY_MESSAGES)
          : chatMessages;
      return await convertToModelMessages(windowed as Parameters<typeof convertToModelMessages>[0]);
    } catch {
      return [{ role: "user" as const, content: messageText }];
    }
  }
  return [{ role: "user" as const, content: messageText }];
}

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

  // ── Subscription check ──
  const subscription = await getUserSubscription(workspace.userId);
  const isPro = subscription?.isActive ?? false;
  console.log(
    `👤 [+${Date.now() - requestStart}ms] Subscription: isPro=${isPro}`,
  );

  // ── Casual message fast-path: skip RAG for greetings / small talk ──
  if (isCasualMessage(messageText)) {
    console.log(
      `💬 [+${Date.now() - requestStart}ms] Casual message detected — skipping RAG pipeline`,
    );

    const coreMessages = await buildCoreMessages(chatMessages, messageText);

    const result = streamText({
      model: getAIModel(provider, modelId),
      system: `You are a friendly documentation assistant called ChatDoc. The user sent a casual message. Respond briefly and warmly, and let them know you're here to help with any documentation questions.`,
      messages: coreMessages,
      onFinish: async ({ text }) => {
        await storeMessage({
          chatId: activeChatId,
          role: "assistant",
          content: text,
        });
        console.log(
          `🏁 [+${Date.now() - requestStart}ms] Casual response complete`,
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

    return result.toUIMessageStreamResponse({
      headers: { "X-Chat-Id": activeChatId },
    });
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
    async (
      input: { messageText: string },
      emitToolStart: (
        toolName: string,
        toolCallId: string,
        toolInput: Record<string, unknown>,
      ) => void,
      emitToolEnd: (toolCallId: string, output: unknown) => void,
    ) => {
      // ── CoT Step: RAG Search ──
      const searchToolId = generateId();
      emitToolStart("search_docs", searchToolId, {
        query: input.messageText.slice(0, 80),
      });

      let search;
      try {
        search = await searchContext(messageText, activeWorkspaceId!, {
          provider,
          modelId,
          topK: safeTopK,
        });
      } catch (error) {
        console.error("RAG search failed:", error);
        emitToolEnd(searchToolId, { error: "Search failed" });
        throw error;
      }

      const uniqueUrls = Array.from(
        new Set(
          search.chunks
            .map((c: { metadata?: { url?: string } }) => c.metadata?.url)
            .filter(Boolean),
        ),
      ).slice(0, 3);
      emitToolEnd(searchToolId, {
        chunks: search.chunks.length,
        confidence: search.confidence,
        urls: uniqueUrls,
      });

      console.log(
        `✅ [+${Date.now() - requestStart}ms] RAG search complete: ${search.chunks.length} chunks, confidence=${search.confidence}`,
      );

      // ── CoT Step: LLM Context Grader ──
      let systemPrompt = search.systemPrompt;

      const graderToolId = generateId();
      emitToolStart("context_grader", graderToolId, {
        chunks: search.chunks.length,
      });

      console.log(
        `🧠 [+${Date.now() - requestStart}ms] Running LLM context grader...`,
      );
      const isContextSufficient = await gradeContextSufficiency(
        messageText,
        search.chunks,
      );

      emitToolEnd(graderToolId, { isContextSufficient });

      console.log(
        `🧠 [+${Date.now() - requestStart}ms] Grader result: isContextSufficient=${isContextSufficient}`,
      );

      if (!isContextSufficient && isPro) {
        // ── CoT Step: Deep Research (Escalation) ──
        const escalationToolId = generateId();
        emitToolStart("deep_research", escalationToolId, {
          reason: "Context insufficient — escalating to deep research",
        });

        console.log(
          `🔄 [+${Date.now() - requestStart}ms] Context insufficient + Pro user — checking escalation...`,
        );
        const escalation = await checkEscalation(
          messageText,
          activeWorkspaceId!,
          search,
          isPro,
          isContextSufficient,
        );
        if (escalation) {
          emitToolEnd(escalationToolId, {
            status: "Agent research complete",
            sources: escalation.sources.length,
          });

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
        } else {
          emitToolEnd(escalationToolId, {
            status: "Escalation unavailable — using RAG answer",
          });
          console.log(
            `⚠️ [+${Date.now() - requestStart}ms] Escalation returned null for Pro user — falling back to RAG answer`,
          );
        }
      } else if (!isContextSufficient && !isPro) {
        console.log(
          `🔄 [+${Date.now() - requestStart}ms] Context insufficient + Free user — adding upgrade hint`,
        );
        systemPrompt += `\n\nNote: The search results have limited coverage for this query. If you cannot provide a satisfactory answer from the context, let the user know and briefly suggest they upgrade to Pro for access to Deep Research mode, which can search the official documentation directly for better answers.`;
      }

      // ── Step 3: Stream answer using AI SDK streamText ──
      console.log(
        `🧠 [+${Date.now() - requestStart}ms] Streaming answer with ${provider}/${modelId || "default"}...`,
      );

      // Convert UIMessages from useChat to CoreMessages for streamText.
      const coreMessages = await buildCoreMessages(chatMessages, messageText);

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

  // ── Build UI message stream with chain-of-thought tool events ──
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // Helper: emit tool-input-available (shows as active step)
      const emitToolStart = (
        toolName: string,
        toolCallId: string,
        input: Record<string, unknown>,
      ) => {
        writer.write({
          type: "tool-input-available",
          toolCallId,
          toolName,
          input,
          dynamic: true,
        });
      };

      // Helper: emit tool-output-available (shows as completed step)
      const emitToolEnd = (toolCallId: string, output: unknown) => {
        writer.write({
          type: "tool-output-available",
          toolCallId,
          output,
          dynamic: true,
        });
      };

      let result;
      try {
        result = await runPipeline({ messageText }, emitToolStart, emitToolEnd);
      } catch (error) {
        console.error("Pipeline error before stream generation:", error);
        throw error;
      }

      // Merge the streamText result into our UI message stream.
      // sendStart: false prevents creating a second assistant message —
      // the outer createUIMessageStream already started one.
      writer.merge(result.toUIMessageStream({ sendStart: false }));
    },
    onError: (error) => {
      console.error("[UIMessageStream] error:", error);
      return error instanceof Error ? error.message : "Stream error";
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: { "X-Chat-Id": activeChatId },
  });
}
