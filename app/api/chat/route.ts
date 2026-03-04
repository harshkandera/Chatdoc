import { currentUser } from "@clerk/nextjs/server";
import { createChat } from "@/lib/chat/createChat";
import { storeMessage } from "@/lib/chat/storeMessage";
import { prisma } from "@/lib/db/prisma";
import { searchContext, checkEscalation } from "@/lib/ai/query/handler";
import { isDomainRelevant } from "@/lib/ai/graph/agent";
import type { ModelProvider } from "@/lib/ai/models";
import { getModelOption } from "@/lib/ai/model-options";
import { ensureUser } from "@/lib/db/user";
import { getUserSubscription } from "@/lib/subscription";
import { checkRateLimit } from "@/lib/redis";
import { polar } from "@/lib/polar";
import * as ai from "ai";
import { getAIModel } from "@/lib/ai/providers";
import { buildAnswerSystemPrompt } from "@/lib/ai/query/generate";
import { buildChatContext } from "@/lib/ai/chat-history";
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

// ── Casual / greeting detection (3-Layer Filter) ──
const CASUAL_PATTERNS =
  /^\s*(h+e+l+o+|h+e+y+|h+i+|h+o+w+d+y+|y+o+|s+u+p+|t+h+a+n+k+s+|t+h+a+n+k+\s*y+o+u+|o+k+|o+k+a+y+|c+o+o+l+|g+r+e+a+t+|b+y+e+|g+o+o+d+b+y+e+|g+o+o+d+\s*m+o+r+n+i+n+g+|g+o+o+d+\s*e+v+e+n+i+n+g+|g+o+o+d+\s*n+i+g+h+t+|g+m+|g+n+|w+h+a+t+s*\s*u+p+|h+o+w+\s*a+r+e+\s*y+o+u+|h+r+u+|l+o+l+|h+a+h+a+|n+i+c+e+|[👋🙏]+)\s*[.!?\s]*$/i;

function passesFastCasualCheck(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length > 50) return false;
  if (t.includes("?")) return false;

  if (/\b(why|how|what|fix|error|issue|explain|help|can|could|would)\b/.test(t))
    return false;

  if (/^hell+o+[^a-z]*$/.test(t)) {
    return true;
  }
  return CASUAL_PATTERNS.test(t);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shouldForceRag(chatMessages: any[] | undefined): boolean {
  if (!chatMessages || chatMessages.length === 0) return false;
  const lastAssistant = [...chatMessages]
    .reverse()
    .find((m) => m.role === "assistant" || m.role === "model");

  if (!lastAssistant) return false;
  const content =
    typeof lastAssistant.content === "string"
      ? lastAssistant.content
      : JSON.stringify(lastAssistant.content);
  return /\?\s*$/.test(content);
}

async function classifyIntent(text: string): Promise<boolean> {
  try {
    const { text: result } = await ai.generateText({
      model: getAIModel("groq", "llama-3.1-8b-instant"),
      system: `Classify the user's intent. Respond ONLY with one word:
- casual → greetings, thanks, acknowledgements, small talk
- question → asking for help, explanation, info, or next steps`,
      messages: [{ role: "user", content: text }],
      maxOutputTokens: 5,
      temperature: 0,
    });
    return result.trim().toLowerCase().includes("casual");
  } catch (err) {
    console.error("Intent classification failed:", err);
    return false; // Fall back to RAG on failure
  }
}

async function isCasualMessage(
  text: string,
  chatMessages: Array<Record<string, unknown>> | undefined,
): Promise<boolean> {
  // Layer 1: Context override
  if (shouldForceRag(chatMessages)) return false;

  // Layer 2: Fast deterministic checks
  const t = text.trim().toLowerCase();
  if (t.length > 50) return false;
  if (t.includes("?")) return false;
  if (/\b(why|how|what|fix|error|issue|explain|can|could|would|help)\b/.test(t))
    return false;

  if (passesFastCasualCheck(text)) return true;

  // Layer 3: Semantic Intent Classification
  return await classifyIntent(text);
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
      const coreMessages = await convertToModelMessages(
        windowed as Parameters<typeof convertToModelMessages>[0],
      );

      // Strip all reasoning content from messages before sending to Groq.
      //
      // convertToModelMessages can produce two reasoning shapes:
      //   1. Top-level `reasoning` property on the message object
      //   2. Content array items with `type: "reasoning"` (the one that was breaking us)
      //
      // We handle both and also drop messages that become empty after stripping.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sanitizeMessagesForGroq = (msgs: any[]): any[] => {
        return (
          msgs
            .map((msg) => {
              if (!msg || typeof msg !== "object") return msg;

              // Remove top-level `reasoning` property
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { reasoning, ...rest } = msg;

              if (Array.isArray(rest.content)) {
                // Filter out content parts with type="reasoning" entirely,
                // then strip any residual `reasoning` property from remaining parts
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                rest.content = rest.content
                  .filter(
                    (part: any) =>
                      !(
                        part &&
                        typeof part === "object" &&
                        part.type === "reasoning"
                      ),
                  )
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  .map((part: any) => {
                    if (part && typeof part === "object") {
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                      const { reasoning: _r, ...partRest } = part;
                      return partRest;
                    }
                    return part;
                  });
              }

              return rest;
            })
            // Drop messages whose content became an empty array after stripping
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((msg: any) => {
              if (!Array.isArray(msg.content)) return true;
              return msg.content.length > 0;
            })
        );
      };

      return sanitizeMessagesForGroq(coreMessages);
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

  // Rate limit: free=20 req/min, pro=60 req/min
  const subForRate = await getUserSubscription(userId);
  const isProUser = subForRate?.isActive ?? false;
  const rateLimit = await checkRateLimit(userId, isProUser ? 60 : 20, 60);
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        error: "Too many requests. Please wait before sending another message.",
        resetIn: rateLimit.resetIn,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rateLimit.resetIn),
        },
      },
    );
  }

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
    // Verify chat belongs to this user before trusting it (#4 chatId IDOR fix)
    const chat = await prisma.chat.findFirst({
      where: { id: activeChatId, userId },
      select: { workspaceId: true },
    });
    if (!chat) {
      return new Response("Forbidden", { status: 403 });
    }
    activeWorkspaceId = chat?.workspaceId;
  }

  console.log(`💾 [+${Date.now() - requestStart}ms] Storing user message...`);
  await storeMessage({
    chatId: activeChatId,
    role: "user",
    content: messageText,
  });
  console.log(`✅ [+${Date.now() - requestStart}ms] User message stored`);

  const streamErrorMessage = async (errorMsg: string) => {
    await storeMessage({
      chatId: activeChatId,
      role: "assistant",
      content: errorMsg,
    });
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: "start" });
        const id = generateId();
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", delta: errorMsg, id });
        writer.write({ type: "text-end", id });
        writer.write({ type: "finish" });
      },
      onError: (err) =>
        err instanceof Error ? err.message : "Error streaming error message",
    });
    return createUIMessageStreamResponse({
      stream,
      headers: { "X-Chat-Id": activeChatId },
    });
  };

  // ── Provider Restriction ──
  const RESTRICT_TO_GROQ = true; // Toggle this to false to allow other providers
  if (RESTRICT_TO_GROQ && provider !== "groq") {
    return await streamErrorMessage(
      "We are currently optimizing non-Groq models. Please select a Groq model from the model selector to continue!",
    );
  }

  if (!activeWorkspaceId) {
    return await streamErrorMessage(
      "No workspace selected. Please select a documentation workspace first.",
    );
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: activeWorkspaceId },
    include: { DocSource: true },
  });

  // Ownership check — prevent IDOR where an attacker sends another user's workspaceId (#4 fix)
  if (!workspace || workspace.userId !== userId) {
    return await streamErrorMessage("Workspace not found or access denied.");
  }

  if (workspace.DocSource.status !== "ready") {
    return await streamErrorMessage(
      "Documentation is not ready. Please wait for indexing to complete.",
    );
  }

  // ── Subscription check ──
  const subscription = await getUserSubscription(workspace.userId);
  const isPro = subscription?.isActive ?? false;
  console.log(
    `👤 [+${Date.now() - requestStart}ms] Subscription: isPro=${isPro}`,
  );

  // ── Casual message fast-path: skip RAG for greetings / small talk ──
  const isCasual = await isCasualMessage(messageText, chatMessages);
  if (isCasual) {
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

  // ── Domain relevance check — fast regex, LLM only if ambiguous ──
  const domainCheck = await isDomainRelevant(
    messageText,
    workspace.DocSource.productName,
    chatMessages,
  );
  if (!domainCheck.relevant) {
    console.log(
      `🚫 [+${Date.now() - requestStart}ms] Off-topic query detected: ${domainCheck.reason}`,
    );
    const offTopicReply = `This workspace is for **${workspace.DocSource.productName}** documentation. I can only answer questions related to ${workspace.DocSource.productName}.\n\nFor other topics, please create a separate workspace.`;
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: "start" });
        const id = generateId();
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", delta: offTopicReply, id });
        writer.write({ type: "text-end", id });
        writer.write({ type: "finish" });
      },
      onError: (err) => (err instanceof Error ? err.message : "Error"),
    });
    return createUIMessageStreamResponse({
      stream,
      headers: { "X-Chat-Id": activeChatId },
    });
  }

  // ── Step 1: RAG Search (synchronous — get context chunks) ──
  console.log(`🔍 [+${Date.now() - requestStart}ms] Running RAG search...`);

  // ── Build dual chat context: recent messages + summary of older chat ──
  const chatContext = await buildChatContext(chatMessages);
  if (chatContext.recentMessages.length > 0) {
    console.log(
      `💬 [+${Date.now() - requestStart}ms] Chat context: ${chatContext.recentMessages.length} recent msgs, summary=${chatContext.summary.length > 0 ? chatContext.summary.length + " chars" : "none"}`,
    );
  }

  const safeTopK = 5;

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
    ): Promise<{
      streamResult: ReturnType<typeof streamText>;
      sources: string[];
    }> => {
      // ── CoT Step: RAG Search ──
      const searchToolId = generateId();
      emitToolStart("search_docs", searchToolId, {
        query: input.messageText.slice(0, 80),
      });

      let search;
      try {
        search = await searchContext(input.messageText, activeWorkspaceId!, {
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
      ) as string[];
      emitToolEnd(searchToolId, {
        chunks: search.chunks.length,
        confidence: search.confidence,
        urls: uniqueUrls.slice(0, 5),
        wasReranked: search.wasReranked ?? false,
      });

      console.log(
        `✅ [+${Date.now() - requestStart}ms] RAG search complete: ${search.chunks.length} chunks, confidence=${search.confidence}`,
      );

      let systemPrompt = search.systemPrompt;
      let usedEscalation = false;
      let escalationSources: string[] = [];

      if (isPro) {
        // ── CoT Step: Deep Research (Pro) ──
        const escalationToolId = generateId();
        emitToolStart("deep_research", escalationToolId, {
          reason: "Pro user — LLM decides if web search needed",
        });

        console.log(
          `🔄 [+${Date.now() - requestStart}ms] Pro user — running agent (LLM decides to answer or search)...`,
        );
        const escalation = await checkEscalation(
          messageText,
          activeWorkspaceId!,
          search,
          isPro,
          undefined, // workspace — handler will fetch
          chatContext.recentMessages,
          chatContext.summary,
        );
        if (escalation) {
          escalationSources = escalation.sources;
          emitToolEnd(escalationToolId, {
            status: "Agent research complete",
            sources: escalation.sources.length,
            urls: escalation.sources.slice(0, 5),
            scrapedPages: escalation.sources.slice(0, 5).map((url: string) => {
              try {
                const { pathname, hostname } = new URL(url);
                const title =
                  pathname === "/"
                    ? hostname
                    : decodeURIComponent(
                        pathname.split("/").filter(Boolean).pop() || hostname,
                      ).replace(/[-_]/g, " ");
                return { url, title };
              } catch {
                return { url, title: url };
              }
            }),
          });

          console.log(
            `🧪 [+${Date.now() - requestStart}ms] Agent provided answer (${escalation.answer.length} chars)`,
          );
          usedEscalation = true;
          const agentAnswer = escalation.answer.slice(0, 6000);
          systemPrompt = `${buildAnswerSystemPrompt(workspace.DocSource.productName)}

Documentation research results:
${agentAnswer}

${escalation.sources.length > 0 ? `Sources:\n${escalation.sources.map((s, i) => `[${i + 1}] ${s}`).join("\n")}` : ""}

Present the above research findings clearly to the user. Do not call any tools.`;
        } else {
          emitToolEnd(escalationToolId, {
            status: "No search needed — answering from indexed docs",
          });
        }
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

      // After escalation, use a reliable text-generation model.
      // gpt-oss-120b (and other agentic models) may try to call tools even
      // when none are registered, causing a Groq API crash.
      const synthesisModel = usedEscalation
        ? getAIModel("groq", "llama-3.3-70b-versatile")
        : getAIModel(provider, modelId);

      const streamResult = streamText({
        model: synthesisModel,
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

      // On the escalation path, surface the agent's scraped URLs.
      // On the normal RAG path, surface the chunk source URLs instead.
      const finalSources = usedEscalation ? escalationSources : uniqueUrls;
      return { streamResult, sources: finalSources };
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

      let pipelineResult;
      try {
        pipelineResult = await runPipeline(
          { messageText },
          emitToolStart,
          emitToolEnd,
        );
      } catch (error) {
        console.error("Pipeline error before stream generation:", error);
        throw error;
      }

      const { streamResult, sources } = pipelineResult;

      // Emit source-url parts so the UI Sources tray can display them.
      for (const url of sources) {
        writer.write({
          type: "source-url",
          sourceId: url,
          url,
        } as Parameters<typeof writer.write>[0]);
      }

      // Merge the actual streamText result into our UI message stream.
      writer.merge(streamResult.toUIMessageStream({ sendStart: false }));
    },
    onError: (error) => {
      console.error("[UIMessageStream] error:", error);
      // Do not leak raw error details (stack traces, DB messages) to the client (#29 fix)
      return "An internal error occurred. Please try again.";
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: { "X-Chat-Id": activeChatId },
  });
}
