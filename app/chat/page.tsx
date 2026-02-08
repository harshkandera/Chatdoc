"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ChatHeader,
  ChatMessages,
  ChatInput,
  type Message,
} from "@/components/chat";
import { WorkspacePanel } from "@/components/workspace";
import { Loader2 } from "lucide-react";
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

export default function ChatPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const workspaceId = searchParams.get("workspace");
  const view = searchParams.get("view");

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState("chatdoc-1.0");
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(!workspaceId && !view);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  // Fetch current workspace data
  const fetchWorkspace = useCallback(async () => {
    if (!workspaceId) {
      setWorkspace(null);
      return;
    }

    try {
      const response = await fetch("/api/workspaces");
      if (response.ok) {
        const workspaces = await response.json();
        const current = workspaces.find((w: Workspace) => w.id === workspaceId);
        setWorkspace(current || null);
      }
    } catch (err) {
      console.error("Failed to fetch workspace:", err);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  // Auto-redirect to first workspace if none selected and not viewing workspaces
  useEffect(() => {
    if (!workspaceId && !view) {
      const fetchAndRedirect = async () => {
        try {
          const response = await fetch("/api/workspaces");
          if (response.ok) {
            const workspaces = await response.json();
            const readyWorkspaces = workspaces.filter(
              (w: { DocSource: { status: string } }) =>
                w.DocSource.status === "ready",
            );
            if (readyWorkspaces.length > 0) {
              router.replace(`/chat?workspace=${readyWorkspaces[0].id}`);
            } else {
              router.replace("/chat?view=workspaces");
            }
          }
        } catch (err) {
          console.error("Failed to fetch workspaces:", err);
          setIsInitializing(false);
        }
      };
      fetchAndRedirect();
    } else {
      setIsInitializing(false);
    }
  }, [workspaceId, view, router]);

  const handleSubmit = async () => {
    if (!input.trim() || isLoading || !workspaceId) return;

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

      // Redirect to the new chat
      if (data.chatId) {
        router.replace(`/chat/${data.chatId}`);
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

  // Show WorkspacePanel when view=workspaces
  if (view === "workspaces") {
    return <WorkspacePanel />;
  }

  // Loading state while auto-redirecting
  if (isInitializing) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 className="w-6 h-6 text-neutral-500 animate-spin" />
        <p className="text-neutral-500 text-sm mt-2">Loading workspace...</p>
      </div>
    );
  }

  return (
    <div className="h-full grid grid-rows-[auto_1fr_auto] overflow-hidden">
      <ChatHeader
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        workspace={workspace}
      />

      <div className="min-h-0 overflow-hidden flex flex-col">
        {/* Error Banner */}
        {error && (
          <div className="mx-4 mt-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm shrink-0">
            {error}
          </div>
        )}

        <ChatMessages messages={messages} isLoading={isLoading} />
      </div>

      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isLoading={isLoading}
        disabled={!workspaceId}
      />
    </div>
  );
}
