"use client";

import { useRef, KeyboardEvent } from "react";
import { Paperclip, Sparkles, ImageIcon, Mic, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  isLoading = false,
  placeholder = "Type your prompt here...",
  disabled = false,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isLoading) {
        onSubmit();
      }
    }
  };

  const actionButtons = [
    { icon: Paperclip, label: "Attach", onClick: () => {} },
    // { icon: Sparkles, label: "Think", onClick: () => {} },
    // { icon: ImageIcon, label: "Edit Image", onClick: () => {} },
  ];

  return (
    <div className="p-4 flex-shrink-0">
      <div className="max-w-3xl mx-auto">
        <div className="relative bg-neutral-900/50 border border-white/[0.08] rounded-2xl backdrop-blur-sm overflow-hidden">
          {/* Textarea */}
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled ? "Select a workspace to start chatting..." : placeholder
            }
            disabled={isLoading || disabled}
            className="min-h-[52px] max-h-[200px] resize-none border-0 bg-transparent text-white placeholder:text-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 pt-4 pb-14 px-4 text-sm"
            rows={1}
          />

          {/* Bottom action bar */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-2">
            {/* Left actions */}
            <TooltipProvider delayDuration={0}>
              <div className="flex items-center gap-1">
                {actionButtons.map((action) => (
                  <Tooltip key={action.label}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={action.onClick}
                        className="text-neutral-400 hover:text-white hover:bg-white/[0.06] gap-1.5 h-8 px-2.5"
                      >
                        <action.icon className="w-4 h-4" />
                        <span className="text-xs">{action.label}</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="bg-neutral-800 text-white border-white/10"
                    >
                      {action.label}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>

            {/* Right actions */}
            <div className="flex items-center gap-2">
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-neutral-400 hover:text-white hover:bg-white/[0.06] gap-1.5 h-8 px-2.5"
                    >
                      <Mic className="w-4 h-4" />
                      <span className="text-xs">Voice</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="bg-neutral-800 text-white border-white/10"
                  >
                    Voice input
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Send button */}
              <Button
                type="button"
                onClick={onSubmit}
                disabled={!value.trim() || isLoading}
                size="icon-sm"
                className="rounded-full bg-white hover:bg-neutral-200 text-black disabled:opacity-30 disabled:bg-neutral-600"
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
