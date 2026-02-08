"use client";

import { useState, useEffect, use, useCallback } from "react";
import {
  ChatHeader,
  ChatMessages,
  ChatInput,
  type Message,
} from "@/components/chat";
import { nanoid } from "nanoid";

interface Workspace {
  id: string;
  name: string;
  DocSource: {
    productName: string;
    rootUrl: string;
    status: string;
    chunkCount: number;
  };
}

export default function ChatWithIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: chatId } = use(params);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState("chatdoc-1.0");
  const [error, setError] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  // Fetch workspace data
  const fetchWorkspace = useCallback(async (wsId: string) => {
    try {
      const response = await fetch("/api/workspaces");
      if (response.ok) {
        const workspaces = await response.json();
        const current = workspaces.find((w: Workspace) => w.id === wsId);
        setWorkspace(current || null);
      }
    } catch (err) {
      console.error("Failed to fetch workspace:", err);
    }
  }, []);

  // Load existing chat messages
  useEffect(() => {
    const loadChat = async () => {
      try {
        const response = await fetch(`/api/chats/${chatId}`);
        if (response.ok) {
          const data = await response.json();
          setWorkspaceId(data.workspaceId);

          // Fetch workspace data
          if (data.workspaceId) {
            fetchWorkspace(data.workspaceId);
          }

          // Convert stored messages to our format
          if (data.messages) {
            const loadedMessages: Message[] = data.messages.map(
              (msg: {
                id: string;
                role: "user" | "assistant";
                content: string;
              }) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
              }),
            );
            setMessages(loadedMessages);
          }
        }
      } catch (err) {
        console.error("Failed to load chat:", err);
      }
    };

    if (chatId) {
      loadChat();
    }
  }, [chatId, fetchWorkspace]);

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: nanoid(),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          message: userMessage.content,
          workspaceId,
          provider: "groq",
        }),
      });

      const data = await response.json();

      if (data.error) {
        setError(data.error);
        setIsLoading(false);
        return;
      }

      const aiMessage: Message = {
        id: nanoid(),
        role: "assistant",
        content: data.content,
        sources: data.sources,
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (err) {
      console.error("Chat error:", err);
      setError("Failed to get response. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      {/* FIXED HEIGHT HEADER */}
      <ChatHeader
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        workspace={workspace}
      />

      {/* FLEXIBLE MIDDLE SECTION - ONLY MESSAGES SCROLL */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Error Banner */}
        {error && (
          <div className="mx-4 mt-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex-shrink-0">
            {error}
          </div>
        )}

        <ChatMessages messages={messages} isLoading={isLoading} />
      </div>

      {/* FIXED HEIGHT INPUT */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isLoading={isLoading}
      />
    </div>
  );
}
