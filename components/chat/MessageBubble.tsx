"use client";

import { useState } from "react";
import { Copy, ThumbsUp, ThumbsDown, RotateCcw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { Sources } from "./Sources";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

interface MessageBubbleProps {
  message: Message;
  isLast?: boolean;
}

// Separate sources from content if they're embedded in markdown
function parseContentAndSources(content: string): {
  cleanContent: string;
  embeddedSources: string[];
} {
  // Check for "---\n**Sources:**" or "---\nSources:" pattern
  const sourcesMatch = content.match(
    /\n---\n\*?\*?Sources:?\*?\*?\n([\s\S]*?)$/i,
  );

  if (sourcesMatch) {
    const cleanContent = content.replace(sourcesMatch[0], "").trim();
    const sourcesSection = sourcesMatch[1];

    // Extract URLs from the sources section
    const urlMatches = sourcesSection.match(/https?:\/\/[^\s\]]+/g) || [];
    return {
      cleanContent,
      embeddedSources: urlMatches,
    };
  }

  return { cleanContent: content, embeddedSources: [] };
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Parse content to separate sources
  const { cleanContent, embeddedSources } = parseContentAndSources(
    message.content,
  );

  // Combine explicit sources with embedded ones
  const allSources = [...(message.sources || []), ...embeddedSources].filter(
    (s, i, arr) => arr.indexOf(s) === i,
  ); // Dedupe

  return (
    <div
      className={cn(
        "flex flex-col gap-2 group",
        isUser ? "items-end" : "items-start",
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={cn(
          "max-w-3xl rounded-2xl px-4 py-3 min-h-12",
          isUser ? "bg-neutral-800 text-white" : "bg-transparent",
        )}
      >
        {isUser ? (
          <p className="text-[15px] leading-relaxed break-words">
            {message.content}
          </p>
        ) : (
          <div className="text-[15px]">
            <Markdown content={cleanContent} />
            <Sources sources={allSources} />
          </div>
        )}
      </div>

      {/* Message actions */}
      <div
        className={cn(
          "flex items-center gap-1 ml-1 transition-opacity",
          isUser
            ? isHovered || copied
              ? "opacity-100"
              : "opacity-0"
            : "opacity-100",
        )}
      >
        {/* Copy button for both user and AI messages */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() =>
            copyToClipboard(isUser ? message.content : cleanContent)
          }
          className="text-neutral-500 hover:text-white hover:bg-white/6 h-7 w-7"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-green-400" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </Button>

        {/* Additional actions for AI messages only */}
        {!isUser && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-neutral-500 hover:text-white hover:bg-white/6 h-7 w-7"
            >
              <ThumbsUp className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-neutral-500 hover:text-white hover:bg-white/6 h-7 w-7"
            >
              <ThumbsDown className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-neutral-500 hover:text-white hover:bg-white/6 h-7 w-7"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
