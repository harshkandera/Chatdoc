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
import { Markdown } from "./Markdown";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  CopyIcon,
  RefreshCcwIcon,
  Search,
  Layers,
  Brain,
  Globe,
  Loader2,
  Check,
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

// ─── Pipeline Step Labels & Icons ───

const TOOL_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; activeLabel?: string }
> = {
  search_docs: {
    label: "Searched documentation",
    activeLabel: "Searching documentation...",
    icon: <Search className="w-3.5 h-3.5 text-blue-400" />,
  },
  multi_search: {
    label: "Searched multiple queries",
    activeLabel: "Running parallel searches...",
    icon: <Layers className="w-3.5 h-3.5 text-blue-400" />,
  },
  decompose_query: {
    label: "Analyzed query complexity",
    activeLabel: "Breaking down your question...",
    icon: <Brain className="w-3.5 h-3.5 text-purple-400" />,
  },
  classify_query: {
    label: "Classified query type",
    activeLabel: "Classifying query...",
    icon: <Brain className="w-3.5 h-3.5 text-purple-400" />,
  },
  web_search_docs: {
    label: "Searched documentation site",
    activeLabel: "Searching documentation site...",
    icon: <Globe className="w-3.5 h-3.5 text-green-400" />,
  },
  deep_research: {
    label: "Deep research completed",
    activeLabel: "Performing deep research...",
    icon: <Brain className="w-3.5 h-3.5 text-amber-400" />,
  },
};

const DEEP_TOOL_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; activeLabel?: string }
> = {
  deep_vector_search: {
    label: "Deep vector search completed",
    activeLabel: "Running deep vector search...",
    icon: <Search className="w-3.5 h-3.5 text-cyan-400" />,
  },
  deep_rerank: {
    label: "Deep reranking completed",
    activeLabel: "Reranking results...",
    icon: <Layers className="w-3.5 h-3.5 text-cyan-400" />,
  },
  deep_generate: {
    label: "Deep answer generated",
    activeLabel: "Generating deep answer...",
    icon: <Brain className="w-3.5 h-3.5 text-cyan-400" />,
  },
};

function getToolConfig(toolName: string) {
  return (
    TOOL_CONFIG[toolName] ||
    DEEP_TOOL_CONFIG[toolName] || {
      label: toolName,
      activeLabel: `Running ${toolName}...`,
      icon: <Search className="w-3.5 h-3.5 text-neutral-400" />,
    }
  );
}

// ─── Pipeline Steps Component ───

function PipelineSteps({ invocations }: { invocations: ToolInvocation[] }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const allComplete = invocations.every((inv) => inv.state === "result");
  const activeCount = invocations.filter(
    (inv) => inv.state !== "result",
  ).length;
  const completedCount = invocations.length - activeCount;

  if (invocations.length === 0) return null;

  return (
    <div className="mb-3 rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-neutral-400 hover:bg-white/[0.03] transition-colors"
      >
        {allComplete ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
        )}
        <span>
          {allComplete
            ? `${invocations.length} step${invocations.length > 1 ? "s" : ""} completed`
            : `${activeCount} step${activeCount > 1 ? "s" : ""} in progress...`}
        </span>

        {/* Progress indicator */}
        {!allComplete && invocations.length > 1 && (
          <span className="text-[10px] text-neutral-500 tabular-nums">
            {completedCount}/{invocations.length}
          </span>
        )}

        <span className="ml-auto">
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </span>
      </button>

      {/* Indeterminate progress bar while steps are running */}
      {!allComplete && (
        <div className="h-[1px] w-full bg-white/[0.04] overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-purple-500/40 to-transparent pipeline-progress-bar" />
        </div>
      )}

      {/* Steps list */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1.5 space-y-1">
          {invocations.map((inv, index) => {
            const config = getToolConfig(inv.toolName);
            const isComplete = inv.state === "result";

            return (
              <div
                key={inv.toolCallId}
                className="pipeline-step-enter flex items-start gap-2 text-xs rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.02]"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                {/* Timeline dot / icon */}
                <div className="mt-0.5 min-w-[16px] flex justify-center">
                  {isComplete ? (
                    <>{config.icon}</>
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <span
                    className={cn(
                      "font-medium",
                      isComplete
                        ? "text-neutral-300"
                        : "text-neutral-400 step-shimmer",
                    )}
                  >
                    {isComplete ? config.label : config.activeLabel}
                  </span>
                  {isComplete &&
                  inv.result != null &&
                  typeof inv.result === "object" ? (
                    <div className="mt-0.5 text-neutral-500 font-mono text-[10px]">
                      {formatToolResult(
                        inv.toolName,
                        inv.result as Record<string, unknown>,
                      )}
                    </div>
                  ) : null}
                </div>

                {/* Status badge */}
                {isComplete && (
                  <CheckCircle2 className="w-3 h-3 text-emerald-500/60 mt-0.5 flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatToolResult(
  toolName: string,
  result: Record<string, unknown>,
): string {
  if (toolName === "search_docs") {
    return `${result.chunks ?? 0} chunks · ${result.confidence ?? "unknown"} confidence`;
  }
  if (toolName === "multi_search") {
    return `${result.totalChunks ?? 0} chunks across queries · ${result.confidence ?? "unknown"} confidence`;
  }
  if (toolName === "decompose_query" && result.subQueries) {
    const queries = result.subQueries as Array<{ query: string }>;
    return queries.map((q) => `"${q.query}"`).join(", ");
  }
  if (toolName === "deep_research") {
    return String(result.status || result.reason || "Agent research complete");
  }
  return "";
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
      <MessageContent>
        <div className="flex items-center gap-2.5 py-2 px-1">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse [animation-delay:300ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse [animation-delay:600ms]" />
          </div>
          <span className="text-sm text-neutral-400 animate-pulse">
            Searching documentation...
          </span>
        </div>
      </MessageContent>
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
  // Match a Sources section: starts with "Sources:" (case-insensitive),
  // followed by lines containing URLs, until a blank line or end of string.
  const sourcesPattern = /\n?\*{0,2}sources:?\*{0,2}\s*\n([\s\S]*?)(?=\n\n|$)/i;

  const match = raw.match(sourcesPattern);
  if (!match) return { body: raw, embeddedUrls: [] };

  const block = match[1] ?? "";
  const urlRegex = /https?:\/\/[^\s)\]]+/g;
  const embeddedUrls = Array.from(block.matchAll(urlRegex), (m) => m[0]);

  // Remove the entire Sources block from the body
  const body = raw.replace(sourcesPattern, "").trimEnd();

  return { body, embeddedUrls };
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
      invocations.push(p.toolInvocation);
      continue;
    }

    // Custom stream events: tool-input-start, tool-input-available, tool-output-available
    // Map these to tool invocations for display
    if (p.type === "tool-input-start" && p.toolCallId && p.toolName) {
      const inv: ToolInvocation = {
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        args: (p.input as Record<string, unknown>) || {},
        state: "call",
      };
      seen.set(p.toolCallId, inv);
      invocations.push(inv);
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
    onRetry,
    precedingUserPrompt,
  }: MessageItemProps) {
    const rawText = getMessageText(message);
    const toolInvocations = getToolInvocations(message);
    const partSourceUrls = getSourceUrls(message);
    const isAssistantStreaming =
      message.role === "assistant" && isLastMessage && status === "streaming";

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
    if (prev.precedingUserPrompt !== next.precedingUserPrompt) return false;
    if (prev.isLastMessage && next.isLastMessage) {
      const prevText = getMessageText(prev.message);
      const nextText = getMessageText(next.message);
      if (prevText !== nextText) return false;
      const prevParts = prev.message.parts?.length ?? 0;
      const nextParts = next.message.parts?.length ?? 0;
      if (prevParts !== nextParts) return false;
    }
    return true;
  },
);

export function ChatMessages({ messages, status, onRetry }: ChatMessagesProps) {
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
