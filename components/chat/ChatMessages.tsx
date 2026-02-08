"use client";

import { MessageBubble, type Message } from "./MessageBubble";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ChatMessagesProps {
  messages: Message[];
  isLoading?: boolean;
}

export function ChatMessages({
  messages,
  isLoading = false,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Auto-scroll to bottom on new messages (depend on length, not array)
  useEffect(() => {
    if (!scrollRef.current) return;

    // Use setTimeout to ensure DOM is updated
    const timer = setTimeout(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: "smooth",
        });
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [messages.length]);

  // Handle scroll to detect if user scrolled up
  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.target as HTMLDivElement;
    const isNearBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight < 100;
    setShowScrollButton(!isNearBottom);
  };

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* ONLY THIS DIV IS SCROLLABLE */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-behavior-contain"
        onScroll={handleScroll}
      >
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              isLast={index === messages.length - 1}
            />
          ))}

          {/* Only show loading dots if last message is user message (waiting for assistant) */}
          {isLoading &&
            messages.length > 0 &&
            messages[messages.length - 1].role === "user" && (
              <div className="flex items-start">
                <div className="flex items-center gap-1 text-neutral-400">
                  <span
                    className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            )}

          {/* Spacer for scroll-to-bottom */}
          <div />
        </div>
      </div>

      {/* Scroll to bottom button */}
      <button
        onClick={() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTo({
              top: scrollRef.current.scrollHeight,
              behavior: "smooth",
            });
          }
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
