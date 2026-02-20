"use client";

import { useEffect, useRef, useState, useCallback, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Message,
  MessageContent,
  MessageToolbar,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
  ChainOfThoughtContent,
} from "@/components/ai-elements/chain-of-thought";
import { Markdown } from "./Markdown";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  CopyIcon,
  RefreshCcwIcon,
  Search,
  Layers,
  Brain,
  Globe,
  Loader2,
  Check,
  Sparkles,
  ShieldCheck,
  Zap,
  Filter,
  FileSearch,
  MessageSquare,
  type LucideIcon,
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

// ─── Chain of Thought: Tool Step Config ───

interface ToolStepConfig {
  label: string;
  activeLabel: string;
  icon: LucideIcon;
}

const TOOL_CONFIGS: Record<string, ToolStepConfig> = {
  // ── RAG Pipeline ──
  search_docs: {
    label: "Searched documentation",
    activeLabel: "Searching documentation...",
    icon: Search,
  },
  multi_search: {
    label: "Ran parallel searches",
    activeLabel: "Running parallel searches...",
    icon: Layers,
  },
  decompose_query: {
    label: "Analyzed query complexity",
    activeLabel: "Breaking down your question...",
    icon: Brain,
  },
  classify_query: {
    label: "Classified query type",
    activeLabel: "Understanding your question...",
    icon: FileSearch,
  },
  // ── Deep Research (Agent Graph) ──
  deep_vector_search: {
    label: "Deep vector search completed",
    activeLabel: "Deep searching documentation...",
    icon: Search,
  },
  context_grader: {
    label: "Context quality verified",
    activeLabel: "Evaluating context quality...",
    icon: ShieldCheck,
  },
  deep_rerank: {
    label: "Results reranked by relevance",
    activeLabel: "Reranking results...",
    icon: Filter,
  },
  deep_generate: {
    label: "Answer generated",
    activeLabel: "Synthesizing answer...",
    icon: Sparkles,
  },
  fallback_generate: {
    label: "Best-effort answer generated",
    activeLabel: "Generating answer from available context...",
    icon: MessageSquare,
  },
  web_search_docs: {
    label: "Searched official documentation",
    activeLabel: "Searching live documentation...",
    icon: Globe,
  },
  deep_research: {
    label: "Deep research completed",
    activeLabel: "Performing deep research...",
    icon: Zap,
  },
};

function getToolConfig(toolName: string): ToolStepConfig {
  return (
    TOOL_CONFIGS[toolName] || {
      label: toolName.replace(/_/g, " "),
      activeLabel: `Running ${toolName.replace(/_/g, " ")}...`,
      icon: Zap,
    }
  );
}

// ─── Chain of Thought: Pipeline Steps Component ───

function formatToolResult(
  toolName: string,
  result: Record<string, unknown>,
): React.ReactNode {
  if (toolName === "search_docs" || toolName === "deep_vector_search") {
    const urls = Array.isArray(result.urls) ? (result.urls as string[]) : [];
    const text =
      toolName === "search_docs"
        ? `${result.chunks ?? 0} chunks · ${result.confidence ?? "unknown"} confidence`
        : `${result.chunks ?? 0} chunks · top score ${result.topScore ?? "—"}`;

    if (urls.length > 0) {
      return (
        <div className="flex flex-col gap-1.5 mt-1 pb-1">
          <div className="flex flex-wrap gap-2 text-sm text-neutral-500 mb-1">
            <span className="text-muted-foreground">{text}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {urls.map((u, i) => {
              try {
                // Remove http/https, but intentionally keep "www." per the screenshot
                const displayUrl = u
                  .replace(/^https?:\/\//, "")
                  .replace(/\/$/, "")
                  .split("/")[0];
                return (
                  <a
                    key={i}
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-3 py-1.5 rounded-full bg-[#1a1a1a] hover:bg-[#222222] text-sm text-neutral-300 transition-colors pointer-events-auto"
                  >
                    <span className="truncate max-w-[200px]">{displayUrl}</span>
                  </a>
                );
              } catch {
                return null;
              }
            })}
          </div>
        </div>
      );
    }
    return <span className="text-muted-foreground">{text}</span>;
  }
  if (toolName === "multi_search") {
    return (
      <span className="text-muted-foreground">{`${result.totalChunks ?? 0} chunks across queries · ${result.confidence ?? "unknown"} confidence`}</span>
    );
  }
  if (toolName === "decompose_query" && result.subQueries) {
    const queries = result.subQueries as Array<{ query: string }>;
    return (
      <span className="text-muted-foreground">
        {queries.map((q) => `"${q.query}"`).join(", ")}
      </span>
    );
  }
  if (toolName === "deep_research") {
    return (
      <span className="text-muted-foreground">
        {String(result.status || result.reason || "Agent research complete")}
      </span>
    );
  }
  if (toolName === "context_grader") {
    const sufficient = result.isContextSufficient;
    return (
      <span className="text-muted-foreground">
        {sufficient ? "Context is sufficient" : "Needs deeper research"}
      </span>
    );
  }
  if (toolName === "deep_rerank") {
    return (
      <span className="text-muted-foreground">{`${result.reranked ?? 0} results · ${result.confidence ?? "unknown"} confidence`}</span>
    );
  }
  if (toolName === "deep_generate") {
    return (
      <span className="text-muted-foreground">{`${result.length ?? 0} chars · ${result.sources ?? 0} sources`}</span>
    );
  }
  if (toolName === "web_search_docs") {
    return (
      <span className="text-muted-foreground">{`${result.toolCalls ?? 0} tool calls executed`}</span>
    );
  }
  if (result.error) {
    return <span className="text-red-400">{`Error: ${result.error}`}</span>;
  }
  return null;
}

function PipelineSteps({ invocations }: { invocations: ToolInvocation[] }) {
  // Defensive render-level dedup by toolCallId (belt-and-suspenders)
  const deduped = invocations.filter(
    (inv, idx, arr) =>
      arr.findIndex((i) => i.toolCallId === inv.toolCallId) === idx,
  );

  if (deduped.length === 0) return null;

  const isComplete = deduped.every((inv) => inv.state === "result");
  const isDeepResearch = deduped.some((inv) =>
    [
      "deep_vector_search",
      "deep_rerank",
      "deep_generate",
      "context_grader",
      "web_search_docs",
      "fallback_generate",
    ].includes(inv.toolName),
  );

  const headerTitle = isComplete
    ? isDeepResearch
      ? "Deep Research Complete"
      : `${deduped.length} step${deduped.length > 1 ? "s" : ""} completed`
    : isDeepResearch
      ? "Deep Research in progress..."
      : "Thinking...";

  return (
    <div className="mb-4">
      <ChainOfThought defaultOpen={true}>
        <ChainOfThoughtHeader>{headerTitle}</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          {deduped.map((inv) => {
            const config = getToolConfig(inv.toolName);
            const isStepComplete = inv.state === "result";
            const isActive =
              inv.state === "call" || inv.state === "partial-call";

            const resultText =
              isStepComplete &&
              inv.result != null &&
              typeof inv.result === "object"
                ? formatToolResult(
                    inv.toolName,
                    inv.result as Record<string, unknown>,
                  )
                : undefined;

            let status: "complete" | "active" | "pending" = "pending";
            if (isStepComplete) status = "complete";
            else if (isActive) status = "active";

            return (
              <ChainOfThoughtStep
                key={inv.toolCallId}
                icon={config.icon}
                label={isStepComplete ? config.label : config.activeLabel}
                description={resultText}
                status={status}
              />
            );
          })}
        </ChainOfThoughtContent>
      </ChainOfThought>
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
  // This regex stops at spaces, brackets, or quotes.
  const urlRegex = /https?:\/\/[^\s)\]"']+/g;

  // 3. Strip trailing punctuation that might have snuck in (e.g. at the end of a sentence).
  const embeddedUrls = Array.from(
    textWithoutCode.matchAll(urlRegex),
    (m) => m[0],
  )
    .map((url) => url.replace(/[,.;:!)\]}]+$/, ""))
    // Also ignore obviously broken/template URLs from AI hallucination
    .filter((url) => !url.includes("{") && !url.includes("}"));

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

    // Legacy custom stream events (pre-v6 backward compat)
    if (p.type === "tool-input-start" && p.toolCallId && p.toolName) {
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
              <PipelineSteps invocations={toolInvocations} />
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
    // Custom comparator: skip re-render if nothing meaningful changed
    if (prev.message.id !== next.message.id) return false;
    if (prev.isLastMessage !== next.isLastMessage) return false;
    if (prev.status !== next.status) return false;
    if (prev.error !== next.error) return false;
    if (prev.precedingUserPrompt !== next.precedingUserPrompt) return false;
    if (prev.isLastMessage && next.isLastMessage) {
      const prevText = getMessageText(prev.message);
      const nextText = getMessageText(next.message);
      if (prevText !== nextText) return false;
      const prevInvs = getToolInvocations(prev.message);
      const nextInvs = getToolInvocations(next.message);
      if (prevInvs.length !== nextInvs.length) return false;
      for (let i = 0; i < prevInvs.length; i++) {
        if (prevInvs[i].state !== nextInvs[i].state) return false;
      }
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
    estimateSize: () => 120, // average message height estimate
    overscan: 5, // render 5 extra items above/below viewport
  });

  // Auto-scroll on new messages or status changes
  useEffect(() => {
    if (!isAutoScrolling.current || itemCount === 0) return;
    virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
  }, [messages.length, status, itemCount, virtualizer]);

  // Throttled auto-scroll during streaming (once per frame)
  useEffect(() => {
    if (status !== "streaming" || !isAutoScrolling.current) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
    });
    return () => cancelAnimationFrame(rafRef.current);
  }, [lastMessageText.length, status, itemCount, virtualizer]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollButton(!isNearBottom);
    isAutoScrolling.current = isNearBottom;
  }, []);

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
                    precedingUserPrompt={(() => {
                      // For assistant messages, find the nearest preceding user message
                      if (messages[virtualRow.index]?.role !== "assistant")
                        return undefined;
                      for (let i = virtualRow.index - 1; i >= 0; i--) {
                        if (messages[i]?.role === "user") {
                          return getMessageText(messages[i]);
                        }
                      }
                      return undefined;
                    })()}
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
