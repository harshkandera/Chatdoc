"use client";

import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputSubmit,
  type PromptInputMessage,
  usePromptInputAttachments,
  PromptInputButton,
} from "@/components/ai-elements/prompt-input";
import { Paperclip, Mic, ArrowUp } from "lucide-react";
import { memo } from "react";

// ─── Types ───

interface ChatInputProps {
  onSubmit: (message: PromptInputMessage) => void;
  status: "streaming" | "submitted" | "ready" | "error";
  disabled?: boolean;
}

// ─── Helper Components ───

const AttachButton = memo(() => {
  const { openFileDialog } = usePromptInputAttachments();
  return (
    <PromptInputButton
      onClick={openFileDialog}
      tooltip="Attach files"
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-foreground"
    >
      <Paperclip className="size-4" />
    </PromptInputButton>
  );
});

AttachButton.displayName = "AttachButton";

const VoiceButton = memo(() => {
  return (
    <PromptInputButton
      tooltip="Voice input (coming soon)"
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-foreground"
      disabled
    >
      <Mic className="size-4" />
    </PromptInputButton>
  );
});

VoiceButton.displayName = "VoiceButton";

// ─── Main Component ───

export function ChatInput({
  onSubmit,
  status,
  disabled = false,
}: ChatInputProps) {
  return (
    <div className="w-full flex justify-center p-4 pb-8 bg-gradient-to-t from-black/80 via-black/50 to-transparent">
      <div className="pointer-events-auto w-full max-w-3xl">
        <PromptInput
          onSubmit={onSubmit}
          className="bg-black/90 border border-white/[0.06] backdrop-blur-xl rounded-[26px] transition-all overflow-hidden [&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:p-0 **:data-[slot=input-group]:ring-0! **:data-[slot=input-group]:border-white/6! shadow-lg shadow-black/20"
        >
          <PromptInputBody className="flex items-center w-full p-1.5 pl-3">
            <AttachButton />
            <PromptInputTextarea
              placeholder={
                disabled ? "Select a workspace..." : "Type your prompt here..."
              }
              disabled={disabled}
              className="flex-1 min-h-[40px] max-h-[200px] border-none shadow-none focus-visible:ring-0 py-2.5 px-3 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-500"
            />
            <div className="flex items-center gap-1.5 pr-1.5">
              <VoiceButton />
              <PromptInputSubmit
                status={status === "streaming" ? "streaming" : "ready"}
                disabled={disabled}
                className="rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors group-has-[textarea:not(:placeholder-shown)]/input-group:bg-white group-has-[textarea:not(:placeholder-shown)]/input-group:text-black group-has-[textarea:not(:placeholder-shown)]/input-group:hover:bg-white/90"
                size="icon-sm"
              >
                <ArrowUp className="size-4" />
              </PromptInputSubmit>
            </div>
          </PromptInputBody>
        </PromptInput>

        <div className="mt-3 text-center">
          <p className="text-xs text-muted-foreground">
            AI can make mistakes. Verify important information.
          </p>
        </div>
      </div>
    </div>
  );
}
