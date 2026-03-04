"use client";

import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Message,
  MessageContent,
  MessageToolbar,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import { Markdown } from "./Markdown";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  CopyIcon,
  RefreshCcwIcon,
  Brain,
  Loader2,
  Check,
  Sparkles,
} from "lucide-react";
import { Sources } from "./Sources";

// ─── Tool Invocation Types ───

interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  state: "partial-call" | "call" | "result";
  result?: unknown;
}

// ─── Chain of Thought: Gemini-style prose thinking block ───

interface ThoughtLine {
  text: string;
  details?: string[];
}

function buildThoughtLine(
  toolName: string,
  result: Record<string, unknown>,
): ThoughtLine {
  switch (toolName) {
    case "deep_vector_search":
    case "search_docs": {
      const chunks = result.chunks ?? 0;
      const score = result.topScore ?? null;
      const confidence = result.confidence ?? null;
      const kgBoosted = typeof result.kgBoosted === "number" ? result.kgBoosted : 0;
      const wasReranked = result.wasReranked ?? false;
      const urls = Array.isArray(result.urls) ? result.urls as string[] : [];

      const scoreStr = score && typeof score === "number" ? ` (score: ${score.toFixed(2)})` : "";
      const confStr = confidence ? ` — ${confidence} confidence` : "";
      const text = `Found ${chunks} relevant chunks${scoreStr}${confStr}`;

      const details: string[] = [];
      if (kgBoosted > 0) details.push(`Knowledge graph boosted ${kgBoosted} chunks`);
      if (wasReranked) details.push("Results were reranked by relevance");
      if (urls.length > 0) {
        details.push(`Sources found:`);
        urls.forEach((u: string) => {
          try {
            const parsed = new URL(u);
            const path = parsed.pathname.replace(/\/$/, "");
            const label = path.length > 1 ? decodeURIComponent(path) : parsed.hostname;
            details.push(`  → ${label}`);
          } catch {
            details.push(`  → ${u}`);
          }
        });
      }
      return { text, details: details.length > 0 ? details : undefined };
    }
    case "context_grader": {
      const sufficient = result.isContextSufficient;
      return {
        text: sufficient
          ? "Context is sufficient — generating answer directly."
          : "Context insufficient — need deeper research.",
        details: sufficient
          ? ["Skipping web search — indexed docs cover this question"]
          : ["Will escalate to web search for better coverage"],
      };
    }
    case "deep_rerank": {
      const n = Array.isArray(result.reranked) ? result.reranked.length : (result.reranked ?? 0);
      const conf = result.confidence ?? "unknown";
      const topScore = result.topScore;
      if (result.skipped) {
        return {
          text: `Skipped reranking — using top ${n} results directly.`,
          details: ["Vector scores were already strong enough"],
        };
      }
      const details: string[] = [`Kept top ${n} chunks (${conf} confidence)`];
      if (topScore && typeof topScore === "number") {
        details.push(`Best match score: ${topScore.toFixed(2)}`);
      }
      return { text: `Reranked results by relevance.`, details };
    }
    case "web_search_docs": {
      const pages = Array.isArray(result.scrapedPages)
        ? (result.scrapedPages as Array<{ url?: string; title?: string }>)
        : [];
      const toolCalls = result.toolCalls;
      if (result.error) return { text: `Web search failed: ${result.error}` };
      if (pages.length > 0) {
        const details = [`Scraped ${pages.length} pages:`];
        pages.forEach((p) => {
          const label = p.title || p.url || "unknown";
          details.push(`  → ${label}`);
        });
        return { text: `Searched live docs and scraped ${pages.length} pages.`, details };
      }
      if (toolCalls && typeof toolCalls === "number") {
        return { text: `Web agent made ${toolCalls} tool call${toolCalls !== 1 ? "s" : ""}.` };
      }
      return { text: "Searching the live documentation site..." };
    }
    case "deep_generate":
    case "fallback_generate": {
      const sources = result.sources ?? 0;
      const length = result.length;
      if (result.error) return { text: `Answer generation failed: ${result.error}` };
      const details: string[] = [];
      if (typeof sources === "number" && sources > 0) details.push(`Referenced ${sources} source${sources !== 1 ? "s" : ""}`);
      if (typeof length === "number") details.push(`Generated ${length} characters`);
      return {
        text: toolName === "fallback_generate"
          ? "Generated best-effort answer from available context."
          : "Answer synthesized from documentation.",
        details: details.length > 0 ? details : undefined,
      };
    }
    case "decompose_query": {
      const queries = result.subQueries as Array<{ query: string; intent?: string }> | undefined;
      if (queries && queries.length > 0) {
        return {
          text: `Broke question into ${queries.length} sub-queries.`,
          details: queries.map((q) => `  → "${q.query}"${q.intent ? ` (${q.intent})` : ""}`),
        };
      }
      return { text: "Analyzed query complexity." };
    }
    case "multi_search": {
      return {
        text: `Parallel search complete — ${result.totalChunks ?? 0} chunks found.`,
        details: result.confidence ? [`Confidence: ${result.confidence}`] : undefined,
      };
    }
    case "deep_research": {
      const n = typeof result.sources === "number" ? result.sources : 0;
      const urls = Array.isArray(result.urls) ? result.urls as string[] : [];
      const pages = Array.isArray(result.scrapedPages)
        ? (result.scrapedPages as Array<{ url?: string; title?: string }>)
        : [];
      if (result.status === "Escalation unavailable — using RAG answer") {
        return { text: "Deep research unavailable — using indexed documentation." };
      }
      const details: string[] = [];
      if (pages.length > 0) {
        details.push(`Researched ${pages.length} pages:`);
        pages.forEach((p) => {
          details.push(`  → ${p.title || p.url || "unknown"}`);
        });
      } else if (urls.length > 0) {
        details.push(`Found ${n} source${n !== 1 ? "s" : ""}:`);
        urls.forEach((u: string) => {
          try {
            const path = new URL(u).pathname.replace(/\/$/, "");
            details.push(`  → ${decodeURIComponent(path) || u}`);
          } catch {
            details.push(`  → ${u}`);
          }
        });
      }
      return {
        text: n > 0 ? `Deep research complete — found ${n} source${n !== 1 ? "s" : ""}.` : "Deep research complete.",
        details: details.length > 0 ? details : undefined,
      };
    }
    default:
      return {
        text: result.error
          ? `${toolName.replace(/_/g, " ")} failed: ${result.error}`
          : `Completed ${toolName.replace(/_/g, " ")}.`,
      };
  }
}

function buildActiveThoughtLine(toolName: string): string {
  switch (toolName) {
    case "deep_vector_search":
    case "search_docs":
      return "Searching through the indexed documentation...";
    case "context_grader":
      return "Evaluating whether the retrieved context is sufficient...";
    case "deep_rerank":
      return "Reranking results by relevance to your question...";
    case "web_search_docs":
      return "Searching the live documentation site for additional context...";
    case "deep_generate":
      return "Synthesizing the final answer...";
    case "fallback_generate":
      return "Generating best-effort answer from available context...";
    case "decompose_query":
      return "Breaking down your question into focused sub-queries...";
    case "multi_search":
      return "Running parallel searches across sub-queries...";
    default:
      return `Running ${toolName.replace(/_/g, " ")}...`;
  }
}

function PipelineSteps({
  invocations,
  hasAnswer,
}: {
  invocations: ToolInvocation[];
  hasAnswer: boolean;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);

  const deduped = invocations.filter(
    (inv, idx, arr) =>
      arr.findIndex((i) => i.toolCallId === inv.toolCallId) === idx,
  );

  // Reset manual override only when this becomes a fresh invocation set
  // (first invocation arrives after being empty). Do NOT reset on every
  // tool result — that causes the panel to flash on each completed step.
  const hadInvocations = useRef(false);
  useEffect(() => {
    if (deduped.length > 0 && !hadInvocations.current) {
      hadInvocations.current = true;
      setManualOpen(null);
    }
    if (deduped.length === 0) {
      hadInvocations.current = false;
    }
  }, [deduped.length]);

  if (deduped.length === 0) return null;

  const isComplete = deduped.every((inv) => inv.state === "result");
  // "Deep Research" label only when the graph agent actually ran (not the fast path).
  // context_grader fires on the fast path too — exclude it from this check.
  const isDeepResearch = deduped.some((inv) =>
    ["deep_vector_search", "deep_rerank", "deep_generate", "web_search_docs", "fallback_generate", "deep_research"].includes(inv.toolName),
  );

  // Auto-collapse when answer arrives, but respect manual toggle
  const isOpen = manualOpen !== null ? manualOpen : !hasAnswer;

  const activeStep = deduped.find(
    (inv) => inv.state === "call" || inv.state === "partial-call",
  );

  const elapsedLabel = isComplete
    ? isDeepResearch ? "Deep Research" : "Thinking"
    : isDeepResearch ? "Researching" : "Thinking";

  const headerLabel = isComplete
    ? `${elapsedLabel} complete`
    : activeStep
      ? buildActiveThoughtLine(activeStep.toolName)
      : `${elapsedLabel}...`;

  // Build prose lines from completed steps.
  // Parse string results (tools may return JSON strings) before filtering.
  const proseLines = deduped
    .filter((inv) => inv.state === "result" && inv.result != null)
    .map((inv) => {
      let parsed = inv.result;
      if (typeof parsed === "string") {
        try { parsed = JSON.parse(parsed); } catch { return null; }
      }
      if (typeof parsed !== "object" || parsed === null) return null;
      return buildThoughtLine(inv.toolName, parsed as Record<string, unknown>);
    })
    .filter((line): line is ThoughtLine => line !== null);

  return (
    <div className="mb-4">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        {/* Header — always visible, clickable */}
        <button
          onClick={() => setManualOpen(!isOpen)}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-500/15 shrink-0">
            {isComplete ? (
              <Brain className="w-3 h-3 text-purple-400" />
            ) : (
              <Loader2 className="w-3 h-3 text-purple-400 animate-spin" />
            )}
          </div>
          <span className="flex-1 text-[12px] font-medium text-neutral-400 truncate">
            {headerLabel}
          </span>
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 text-neutral-500 transition-transform shrink-0",
              isOpen ? "rotate-180" : "rotate-0",
            )}
          />
        </button>

        {/* Collapsible prose content — grid-rows transition for smooth height animation */}
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-in-out",
            isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="px-4 pb-3 pt-0.5 border-t border-white/[0.04]">
              <div className="space-y-2.5">
                {proseLines.map((line, idx) => (
                  <div key={`${line.text.slice(0, 40)}-${idx}`}>
                    <p className="text-[12.5px] leading-relaxed text-neutral-400 font-medium">
                      {line.text}
                    </p>
                    {line.details && line.details.length > 0 && (
                      <div className="mt-1 ml-2 space-y-0.5">
                        {line.details.map((detail, i) => (
                          <p
                            key={i}
                            className="text-[11.5px] leading-relaxed text-neutral-500"
                          >
                            {detail}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {/* Active step — shown while tool is running */}
                {!isComplete && activeStep && (
                  <p className="text-[12.5px] leading-relaxed text-neutral-400 italic animate-pulse">
                    {buildActiveThoughtLine(activeStep.toolName)}
                  </p>
                )}
                {proseLines.length === 0 && !activeStep && (
                  <p className="text-[12.5px] text-neutral-600 italic">
                    Initializing...
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helper Components ───

interface CopyActionProps {
  content: string;
}

function CopyAction({ content }: CopyActionProps) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, [content]);

  return (
    <MessageAction
      label={isCopied ? "Copied" : "Copy"}
      onClick={handleCopy}
      tooltip={isCopied ? "Copied!" : "Copy to clipboard"}
    >
      {isCopied ? (
        <Check className="size-4 text-green-500" />
      ) : (
        <CopyIcon className="size-4" />
      )}
    </MessageAction>
  );
}

// ─── Typing / Thinking Indicator ───

function ThinkingIndicator() {
  return (
    <Message from="assistant">
      <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-transparent overflow-hidden backdrop-blur-sm px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-500/15 cot-header-glow">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-neutral-300 tracking-wide cot-text-shimmer">
              Analyzing your question...
            </span>
            <div className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-purple-400 animate-pulse [animation-delay:0ms]" />
              <span className="w-1 h-1 rounded-full bg-purple-400 animate-pulse [animation-delay:200ms]" />
              <span className="w-1 h-1 rounded-full bg-purple-400 animate-pulse [animation-delay:400ms]" />
              <span className="text-[10px] text-neutral-500 ml-1">
                Searching documentation
              </span>
            </div>
          </div>
        </div>
        <div className="mt-2 h-[2px] w-full bg-white/[0.03] overflow-hidden rounded-full">
          <div className="h-full w-full cot-progress-bar" />
        </div>
      </div>
    </Message>
  );
}

// ─── Streaming Cursor ───

function StreamingCursor() {
  return <span className="streaming-cursor" />;
}

// ─── Helpers ───

// Extract accumulated text from UIMessage parts.
// In AI SDK v6, useChat produces parts with type "text" whose `text` field
// is progressively updated during streaming (text-delta is an internal
// protocol detail and never appears in UIMessage.parts).

function getMessageText(message: {
  parts?: Array<{ type: string; text?: string; state?: string }>;
  content?: string;
}): string {
  if (message.parts && message.parts.length > 0) {
    const textParts = message.parts.filter((p) => p.type === "text");
    if (textParts.length > 0) {
      return textParts.map((p) => p.text || "").join("");
    }
  }
  return message.content || "";
}

/**
 * Strips the embedded "Sources:" markdown block from AI response text
 * and returns the clean body + the extracted URLs separately.
 *
 * Handles patterns like:
 *   Sources:
 *   - [1] https://...
 *   • [1] https://...
 *   [1] https://...
 */
function parseMessageContent(raw: string): {
  body: string;
  embeddedUrls: string[];
} {
  // 1. Remove Markdown code blocks entirely before searching for URLs,
  // so we don't extract API endpoint examples (like in curl or python scripts).
  const textWithoutCode = raw.replace(/```[\s\S]*?```/g, "");

  // 2. Extract ALL URLs from the clean text for the Sources tray.
  // Excludes <> to avoid capturing angle-bracket notation like <https://url> or trailing >
  const urlRegex = /https?:\/\/[^\s)\]"'<>`]+/g;

  // 3. Strip trailing punctuation that might have snuck in (e.g. at the end of a sentence).
  const embeddedUrls = Array.from(
    textWithoutCode.matchAll(urlRegex),
    (m) => m[0],
  )
    .map((url) => url.replace(/[,.;:!)\]}`]+$/, ""))
    // Validate: must have a real hostname (at least one dot), no template placeholders
    .filter((url) => {
      if (url.includes("{") || url.includes("}")) return false;
      if (url.includes("`")) return false;
      try {
        const { hostname } = new URL(url);
        return hostname.includes(".");
      } catch {
        return false;
      }
    });

  // 4. Handle explicit "Sources:" block in the original text (we want to hide this block)
  const sourcesPattern = /\n?\*{0,2}sources:?\*{0,2}\s*\n([\s\S]*?)(?=\n\n|$)/i;
  let body = raw.replace(sourcesPattern, "");

  // 5. Clean up inline "[1] https://..." links from the body
  const inlineLinkPattern = /(\[\d+\])\s*https?:\/\/[^\s)\]"']+/g;
  body = body.replace(inlineLinkPattern, "$1");

  // 6. Unwrap ` ```markdown ` blocks that the AI sometimes unnecessarily wraps tables or its entire response in
  const markdownBlockPattern = /```markdown\s*\n([\s\S]*?)\n```/gi;
  body = body.replace(markdownBlockPattern, "$1");

  return { body: body.trimEnd(), embeddedUrls };
}

function getToolInvocations(message: {
  parts?: Array<{
    type: string;
    toolInvocation?: ToolInvocation;
    toolCallId?: string;
    toolName?: string;
    input?: unknown;
    output?: unknown;
    state?: string;
  }>;
}): ToolInvocation[] {
  if (!message.parts) return [];

  const invocations: ToolInvocation[] = [];
  const seen = new Map<string, ToolInvocation>();

  for (const p of message.parts) {
    // Standard AI SDK tool-invocation parts
    if (p.type === "tool-invocation" && p.toolInvocation) {
      const inv = p.toolInvocation;
      const existing = seen.get(inv.toolCallId);
      if (existing) {
        // Merge: keep the most-advanced state
        if (inv.state === "result") {
          existing.state = "result";
          existing.result = inv.result;
        }
      } else {
        seen.set(inv.toolCallId, inv);
        invocations.push(inv);
      }
      continue;
    }

    // AI SDK v6 dynamic-tool parts (from createUIMessageStream writer)
    if (p.type === "dynamic-tool" && p.toolCallId && p.toolName) {
      const isComplete =
        p.state === "output-available" || p.state === "output-done";
      const existing = seen.get(p.toolCallId);
      if (existing) {
        if (isComplete) {
          existing.state = "result";
          existing.result = p.output;
        }
      } else {
        const inv: ToolInvocation = {
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          args: (p.input as Record<string, unknown>) || {},
          state: isComplete ? "result" : "call",
          result: isComplete ? p.output : undefined,
        };
        seen.set(p.toolCallId, inv);
        invocations.push(inv);
      }
      continue;
    }

    // Custom stream events written by route.ts via createUIMessageStream writer
    // tool-input-available → tool in "call" state (active/in-progress)
    if (
      (p.type === "tool-input-available" || p.type === "tool-input-start") &&
      p.toolCallId &&
      p.toolName
    ) {
      if (!seen.has(p.toolCallId)) {
        const inv: ToolInvocation = {
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          args: (p.input as Record<string, unknown>) || {},
          state: "call",
        };
        seen.set(p.toolCallId, inv);
        invocations.push(inv);
      }
    }

    if (p.type === "tool-output-available" && p.toolCallId) {
      const existing = seen.get(p.toolCallId);
      if (existing) {
        existing.state = "result";
        existing.result = p.output;
      } else {
        // Result arrived before start (e.g. parts rehydrated out of order)
        const inv: ToolInvocation = {
          toolCallId: p.toolCallId,
          toolName: (p as { toolName?: string }).toolName || "unknown",
          args: {},
          state: "result",
          result: p.output,
        };
        seen.set(p.toolCallId, inv);
        invocations.push(inv);
      }
    }
  }

  return invocations;
}

function getSourceUrls(message: {
  parts?: Array<{
    type: string;
    source?: { url: string };
    sourceId?: string;
    url?: string;
    toolInvocation?: ToolInvocation;
  }>;
}): string[] {
  if (!message.parts) return [];

  const urls: string[] = [];

  for (const part of message.parts) {
    // AI SDK source parts
    if (part.type === "source" && part.source?.url) {
      urls.push(part.source.url);
    }
    // source-url parts (from our custom stream events)
    if ((part.type === "source-url" || part.type === "source") && part.url) {
      urls.push(part.url);
    }
    // Also check sourceId field for source-url parts
    if (part.type === "source-url" && part.sourceId) {
      urls.push(part.sourceId);
    }
    // Extract sources from tool invocation results as fallback
    if (
      part.type === "tool-invocation" &&
      part.toolInvocation?.state === "result" &&
      part.toolInvocation.result != null &&
      typeof part.toolInvocation.result === "object"
    ) {
      const result = part.toolInvocation.result as Record<string, unknown>;
      if (Array.isArray(result.sources)) {
        for (const src of result.sources) {
          if (typeof src === "string" && src.startsWith("http")) {
            urls.push(src);
          }
        }
      }
    }
  }

  return [...new Set(urls)];
}

// ─── Main Component Types ───

interface ChatMessagesProps {
  messages: Array<{
    id: string;
    role: string;
    parts?: Array<{
      type: string;
      text?: string;
      state?: string;
      toolInvocation?: ToolInvocation;
      source?: { url: string };
      sourceId?: string;
      url?: string;
    }>;
    content?: string;
  }>;
  status?: "streaming" | "submitted" | "ready" | "error";
  error?: Error | string | null;
  onRetry?: (userPrompt: string) => void;
}

// ─── Memoized Message Item ───
// KEY performance fix: without memo, every token update causes ALL messages
// to re-render (getMessageText, getToolInvocations, getSourceUrls each
// recomputed for every message on every token). With memo, only the
// currently-streaming message re-renders.

interface MessageItemProps {
  message: ChatMessagesProps["messages"][0];
  isLastMessage: boolean;
  status: ChatMessagesProps["status"];
  error?: ChatMessagesProps["error"];
  onRetry?: (userPrompt: string) => void;
  // The user message text that prompted this assistant response.
  // Used so retry re-sends the correct prompt regardless of position.
  precedingUserPrompt?: string;
}

const MessageItem = memo(
  function MessageItem({
    message,
    isLastMessage,
    status,
    error,
    onRetry,
    precedingUserPrompt,
  }: MessageItemProps) {
    const rawText = getMessageText(message);
    const toolInvocations = getToolInvocations(message);
    const partSourceUrls = getSourceUrls(message);
    const isAssistantStreaming =
      message.role === "assistant" && isLastMessage && status === "streaming";
    const isAssistantError =
      message.role === "assistant" &&
      isLastMessage &&
      status === "error" &&
      error;

    // Strip embedded "Sources:" block from text and merge URLs with part sources
    const { body: text, embeddedUrls } = parseMessageContent(rawText);
    const sourceUrls = Array.from(
      new Set([...partSourceUrls, ...embeddedUrls]),
    );

    return (
      <Message from={message.role as "user" | "assistant"}>
        {message.role === "user" ? (
          <div className="group">
            <MessageContent>
              <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">
                {text}
              </div>
            </MessageContent>
            {/* Copy button — only visible on hover */}
            {text && (
              <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <MessageToolbar>
                  <MessageActions>
                    <CopyAction content={text} />
                  </MessageActions>
                </MessageToolbar>
              </div>
            )}
          </div>
        ) : (
          <>
            {toolInvocations.length > 0 && (
              <PipelineSteps invocations={toolInvocations} hasAnswer={!!text} />
            )}

            <MessageContent>
              {isAssistantStreaming ? (
                <div className="streaming-text text-[15px] leading-relaxed text-foreground">
                  <span>{text}</span>
                  <StreamingCursor />
                </div>
              ) : isAssistantError ? (
                <div className="flex flex-col gap-2">
                  {text && <Markdown content={text} className="text-[15px]" />}
                  <div className="mt-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      Generation Failed
                    </div>
                    <div className="text-destructive/80 leading-relaxed">
                      {typeof error === "string"
                        ? error
                        : error?.message || "An unknown error occurred"}
                    </div>
                  </div>
                </div>
              ) : text ? (
                <Markdown content={text} className="text-[15px]" />
              ) : isLastMessage &&
                (status === "submitted" || status === "streaming") ? (
                <div className="flex items-center gap-2 py-1">
                  <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
                  <span className="text-sm text-neutral-400">
                    Generating response...
                  </span>
                </div>
              ) : null}
            </MessageContent>

            {sourceUrls.length > 0 && <Sources sources={sourceUrls} />}

            {/* Retry + copy below every assistant message (not while streaming) */}
            {!isAssistantStreaming && status !== "submitted" && text && (
              <MessageToolbar>
                <MessageActions>
                  <MessageAction
                    label="Retry"
                    onClick={() => onRetry?.(precedingUserPrompt ?? "")}
                    tooltip="Regenerate response"
                  >
                    <RefreshCcwIcon className="size-4" />
                  </MessageAction>
                  <CopyAction content={text} />
                </MessageActions>
              </MessageToolbar>
            )}
          </>
        )}
      </Message>
    );
  },
  (prev, next) => {
    // Cheap identity checks first
    if (prev.message.id !== next.message.id) return false;
    if (prev.isLastMessage !== next.isLastMessage) return false;
    if (prev.status !== next.status) return false;
    if (prev.error !== next.error) return false;
    if (prev.precedingUserPrompt !== next.precedingUserPrompt) return false;

    // Only the streaming message needs deep comparison — completed messages never change
    if (!prev.isLastMessage) return true;

    // Compare part count (cheapest proxy for "did anything change")
    const prevParts = prev.message.parts ?? [];
    const nextParts = next.message.parts ?? [];
    if (prevParts.length !== nextParts.length) return false;

    // Compare text content directly from parts (avoids calling getMessageText twice)
    const prevText = prevParts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
    const nextText = nextParts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
    if (prevText !== nextText) return false;

    // Compare tool invocation states (type + state only — no full parse)
    // useChat transforms tool-input-available/tool-output-available → "dynamic-tool" parts
    const prevToolParts = prevParts.filter((p) =>
      p.type === "tool-invocation" || p.type === "dynamic-tool" ||
      p.type === "tool-output-available" || p.type === "tool-input-available",
    );
    const nextToolParts = nextParts.filter((p) =>
      p.type === "tool-invocation" || p.type === "dynamic-tool" ||
      p.type === "tool-output-available" || p.type === "tool-input-available",
    );
    if (prevToolParts.length !== nextToolParts.length) return false;
    for (let i = 0; i < prevToolParts.length; i++) {
      if (prevToolParts[i].state !== nextToolParts[i].state) return false;
    }

    return true;
  },
);

export function ChatMessages({
  messages,
  status,
  error,
  onRetry,
}: ChatMessagesProps) {
  "use no memo"; // Tell React Compiler to skip this component

  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const rafRef = useRef<number>(0);
  const isAutoScrolling = useRef(true);

  const lastMessage = messages[messages.length - 1];
  const lastMessageText = lastMessage ? getMessageText(lastMessage) : "";
  const lastToolInvocations = lastMessage
    ? getToolInvocations(lastMessage)
    : [];

  const showThinkingIndicator =
    status === "submitted" &&
    (!lastMessage || lastMessage.role === "user") &&
    lastToolInvocations.length === 0;

  // Total item count: messages + thinking indicator (if visible)
  const itemCount = messages.length + (showThinkingIndicator ? 1 : 0);

  // ─── Virtualizer ───
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 200, // higher estimate reduces layout jumps for CoT-heavy messages
    overscan: 5, // render 5 extra items above/below viewport
  });

  // Auto-scroll on new messages or status changes
  useEffect(() => {
    if (!isAutoScrolling.current || itemCount === 0) return;
    virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
  }, [messages.length, status, itemCount, virtualizer]);

  // Track tool invocation count so scroll triggers when CoT panels appear/update
  const lastToolInvocationCount = lastToolInvocations.length;
  const lastToolCompleteCount = lastToolInvocations.filter(
    (inv) => inv.state === "result",
  ).length;

  // Throttled auto-scroll during streaming (once per frame)
  // Triggers on: text length change, new tool invocations, tool completions
  useEffect(() => {
    if (
      (status !== "streaming" && status !== "submitted") ||
      !isAutoScrolling.current
    )
      return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
    });
    return () => cancelAnimationFrame(rafRef.current);
  }, [
    lastMessageText.length,
    lastToolInvocationCount,
    lastToolCompleteCount,
    status,
    itemCount,
    virtualizer,
  ]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollButton(!isNearBottom);
    isAutoScrolling.current = isNearBottom;
  }, []);

  // Pre-compute preceding user prompt for each assistant message once,
  // rather than running a loop inside the virtualizer render per frame.
  // Must be called BEFORE the early return to keep hook order stable.
  const precedingUserPrompts = useMemo(() => {
    const map = new Map<string, string>();
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === "assistant") {
        for (let j = i - 1; j >= 0; j--) {
          if (messages[j].role === "user") {
            map.set(messages[i].id, getMessageText(messages[j]));
            break;
          }
        }
      }
    }
    return map;
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-medium text-white mb-2">
            Welcome to ChatDoc
          </h2>
          <p className="text-neutral-400 text-sm max-w-md">
            Start a conversation by typing a message below. Ask questions about
            your documentation and get accurate, sourced answers.
          </p>
        </div>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-behavior-contain"
        onScroll={handleScroll}
      >
        {/* Total height spacer for correct scrollbar */}
        <div
          className="max-w-4xl mx-auto w-full px-4 relative"
          style={{ height: virtualizer.getTotalSize() + 64 }}
        >
          {/* Only render visible items (windowed) */}
          {virtualItems.map((virtualRow) => {
            const isThinkingRow = virtualRow.index >= messages.length;

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="py-3"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start + 32}px)`,
                }}
              >
                {isThinkingRow ? (
                  <ThinkingIndicator />
                ) : (
                  <MessageItem
                    message={messages[virtualRow.index]}
                    isLastMessage={virtualRow.index === messages.length - 1}
                    status={status}
                    error={error}
                    onRetry={onRetry}
                    precedingUserPrompt={precedingUserPrompts.get(messages[virtualRow.index]?.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scroll to bottom button */}
      <button
        onClick={() => {
          isAutoScrolling.current = true;
          virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
        }}
        className={cn(
          "absolute bottom-4 left-1/2 -translate-x-1/2 p-2 bg-neutral-800 hover:bg-neutral-700 border border-white/10 rounded-full shadow-lg transition-all z-20",
          showScrollButton
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4 pointer-events-none",
        )}
      >
        <ChevronDown className="w-5 h-5 text-white" />
      </button>
    </div>
  );
}
