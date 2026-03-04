import { invokeModel } from "./models";
import type { ModelProvider } from "./model-options";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatContext {
  /** Last 3-4 raw messages for immediate conversational context */
  recentMessages: ChatMessage[];
  /** Summarised version of all older messages (empty if chat is short) */
  summary: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Number of most-recent messages to keep in raw form */
const RECENT_WINDOW = 4;

/** Max character length for summary input (prevents token explosion) */
const MAX_SUMMARY_INPUT_CHARS = 4000;

// ─── Build Chat Context ───────────────────────────────────────────────────────

/**
 * Split a conversation into two parts:
 *
 * 1. **recentMessages** — the last `RECENT_WINDOW` messages, kept verbatim.
 *    These give the LLM precise short-term context (follow-up references,
 *    pronouns, code snippets the user just shared, etc.)
 *
 * 2. **summary** — a compressed natural-language summary of everything before
 *    the recent window.  Only generated when the conversation is long enough
 *    to benefit (6+ messages).  Uses the small/fast model to keep latency low.
 *
 * The caller should pass both pieces to the LangGraph agent so it has full
 * conversational awareness without blowing up the context window.
 */
export async function buildChatContext(
  chatMessages: Array<Record<string, unknown>> | undefined,
): Promise<ChatContext> {
  const empty: ChatContext = { recentMessages: [], summary: "" };
  if (!chatMessages || chatMessages.length === 0) return empty;

  // ── Extract plain {role, content} pairs ────────────────────────────────
  const flat: ChatMessage[] = chatMessages
    .map((m) => {
      const role =
        (m.role as string) === "assistant" || (m.role as string) === "model"
          ? "assistant"
          : "user";
      const content =
        typeof m.content === "string"
          ? m.content
          : (
              m.parts as Array<{ type: string; text?: string }> | undefined
            )?.find((p) => p.type === "text")?.text || "";
      return { role, content };
    })
    .filter((m) => m.content.length > 0);

  if (flat.length === 0) return empty;

  // ── Split into recent window + older history ───────────────────────────
  const recentMessages = flat.slice(-RECENT_WINDOW);

  // Only summarise if there are messages older than the recent window
  const olderMessages = flat.slice(0, Math.max(0, flat.length - RECENT_WINDOW));

  if (olderMessages.length < 2) {
    // Not enough older history to warrant a summary
    return { recentMessages, summary: "" };
  }

  // ── Generate summary of older messages ─────────────────────────────────
  const summary = await summariseMessages(olderMessages);
  return { recentMessages, summary };
}

// ─── Summarise Messages ───────────────────────────────────────────────────────

/**
 * Compress a list of messages into a concise paragraph.
 * Uses the cheapest/fastest model available (SMALL_MODEL_PROVIDER).
 */
async function summariseMessages(messages: ChatMessage[]): Promise<string> {
  // Build a conversation transcript, truncating if needed
  let transcript = messages
    .map(
      (m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`,
    )
    .join("\n");

  if (transcript.length > MAX_SUMMARY_INPUT_CHARS) {
    transcript = transcript.slice(-MAX_SUMMARY_INPUT_CHARS);
  }

  const provider = (process.env.SMALL_MODEL_PROVIDER ||
    "groq") as ModelProvider;
  const modelId = process.env.SMALL_MODEL_ID || "llama-3.1-8b-instant";

  try {
    const response = await invokeModel(
      provider,
      [
        {
          role: "system",
          content: `Summarise the following conversation history into a brief paragraph (max 150 words). Focus on:
- What the user was asking about
- Key information the assistant provided
- Any decisions, preferences, or context that a follow-up answer would need

Do NOT include greetings or filler. Write in third person ("The user asked about X. The assistant explained Y.").`,
        },
        {
          role: "user",
          content: transcript,
        },
      ],
      modelId,
    );

    return response.trim();
  } catch (err) {
    console.warn("[ChatHistory] Summary generation failed:", err);
    // Graceful fallback: return truncated raw transcript
    return transcript.length > 300
      ? `Previous conversation (truncated): ${transcript.slice(-300)}`
      : `Previous conversation: ${transcript}`;
  }
}
