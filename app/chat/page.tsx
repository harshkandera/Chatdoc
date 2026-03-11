"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import { WorkspacePanel } from "@/components/workspace";
import { Loader2 } from "lucide-react";
import { DEFAULT_MODEL_ID } from "@/lib/ai/model-options";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

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

function ChatContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const workspaceId = searchParams.get("workspace");
  const view = searchParams.get("view");

  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(!workspaceId && !view);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const chatIdRef = useRef<string | null>(null);

  // Render-time state adjustments
  if (!workspaceId && workspace !== null) {
    setWorkspace(null);
  }

  if ((workspaceId || view) && isInitializing) {
    setIsInitializing(false);
  }

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: {
          workspaceId,
          modelOptionId: selectedModel,
        },
        fetch: async (url, options) => {
          // Inject the current chatId into every request body
          const body = JSON.parse((options?.body as string) || "{}");
          if (chatIdRef.current) body.chatId = chatIdRef.current;
          const response = await fetch(url, {
            ...options,
            body: JSON.stringify(body),
          });
          // Capture chatId from the first response and reuse it for all subsequent messages
          const returnedChatId = response.headers.get("X-Chat-Id");
          if (returnedChatId) chatIdRef.current = returnedChatId;
          return response;
        },
      }),
    [workspaceId, selectedModel],
  );

  const { messages, status, sendMessage } = useChat({
    transport,
    onError: (err) => {
      console.error("useChat error:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
    },
  });

  // Fetch current workspace data
  useEffect(() => {
    if (!workspaceId) return;

    let isMounted = true;

    const fetchWorkspace = async () => {
      try {
        const response = await fetch("/api/workspaces");
        if (response.ok && isMounted) {
          const workspaces = await response.json();
          const current = workspaces.find(
            (w: Workspace) => w.id === workspaceId,
          );
          if (isMounted) {
            setWorkspace(current || null);
          }
        }
      } catch (err) {
        if (isMounted) {
          console.error("Failed to fetch workspace:", err);
        }
      }
    };

    fetchWorkspace();

    return () => {
      isMounted = false;
    };
  }, [workspaceId]);

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
    }
  }, [workspaceId, view, router]);

  // Handle message submit from PromptInput
  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (!message.text?.trim() || !workspaceId) return;
      setError(null);
      sendMessage({
        text: message.text,
        files: message.files,
      });
    },
    [workspaceId, sendMessage, setError],
  );

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
        <ChatMessages messages={messages} status={status} error={error} />
      </div>

      <ChatInput
        onSubmit={handleSubmit}
        status={status}
        disabled={!workspaceId}
      />
    </div>
  );
}

function ChatContentWithKey() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspace");
  const view = searchParams.get("view");
  return <ChatContent key={`${workspaceId ?? "none"}-${view ?? "chat"}`} />;
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Loader2 className="w-6 h-6 text-neutral-500 animate-spin" />
        </div>
      }
    >
      <ChatContentWithKey />
    </Suspense>
  );
}
