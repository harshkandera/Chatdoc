"use client";

import { useChat } from "@ai-sdk/react";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { DefaultChatTransport, UIMessage } from "ai";
import { DEFAULT_MODEL_ID } from "@/lib/ai/model-options";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

interface Workspace {
  id: string;
  name: string;
  docSourceId: string;
  DocSource: {
    productName: string;
    rootUrl: string;
    status: string;
    chunkCount: number;
  };
}

export default function ClientPage({
  initialMessages,
  workspace,
}: {
  initialMessages: UIMessage[];
  workspace?: Workspace | null;
}) {
  const params = useParams();
  const chatId = params.id as string;
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);

  // Create transport ONCE with stable fields only.
  // Do NOT put selectedModel in the transport body — useChat captures the
  // transport on first mount and never re-reads it when it changes, so
  // updating selectedModel here has zero effect on subsequent requests.
  // Instead, pass modelOptionId per-request via sendMessage/regenerate body.

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: {
          chatId,
          workspaceId: workspace?.id,
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // intentionally stable — created only once on mount
  );

  const { messages, status, sendMessage } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    onError: (err) => {
      console.error("useChat error:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
    },
    onFinish: ({ message }) => {
      console.log("✅ [useChat] onFinish — final message:", message);
    },
  });

  // Pass modelOptionId in the per-request body so every message carries the
  // currently selected model, regardless of when the transport was created.
  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (!message.text?.trim()) return;
      setError(null);
      sendMessage(
        { text: message.text, files: message.files },
        {
          body: {
            chatId,
            workspaceId: workspace?.id,
            modelOptionId: selectedModel,
          },
        },
      );
    },
    [sendMessage, chatId, workspace?.id, selectedModel],
  );

  // Retry a specific user prompt — re-sends that exact message text.
  // This lets retry work correctly for any message in the conversation,
  // not just the last one.
  const handleRetry = useCallback(
    (userPrompt: string) => {
      if (!userPrompt.trim()) return;
      setError(null);
      sendMessage(
        { text: userPrompt },
        {
          body: {
            chatId,
            workspaceId: workspace?.id,
            modelOptionId: selectedModel,
          },
        },
      );
    },
    [sendMessage, chatId, workspace?.id, selectedModel],
  );

  return (
    <div className="flex flex-col h-screen bg-background">
      <ChatHeader
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        workspace={workspace}
      />

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-4 md:px-8">
        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 text-destructive text-sm shrink-0">
            {error}
          </div>
        )}

        <ChatMessages
          messages={messages}
          status={status}
          onRetry={handleRetry}
        />
      </div>

      <ChatInput onSubmit={handleSubmit} status={status} />
    </div>
  );
}
