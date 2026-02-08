"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Loader2,
  Globe,
  Check,
  AlertCircle,
  FileText,
  Plus,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaces: Workspace[];
  onWorkspaceCreated?: () => void;
}

type TabType = "select" | "add";
type AddState = "input" | "verifying" | "success" | "error";

export function NewChatModal({
  isOpen,
  onClose,
  workspaces,
  onWorkspaceCreated,
}: NewChatModalProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>("select");
  const [url, setUrl] = useState("");
  const [addState, setAddState] = useState<AddState>("input");
  const [error, setError] = useState("");
  const [newWorkspaceId, setNewWorkspaceId] = useState<string | null>(null);

  const handleSelectWorkspace = (workspace: Workspace) => {
    if (workspace.DocSource.status === "ready") {
      router.push(`/chat?workspace=${workspace.id}`);
      handleClose();
    }
  };

  const handleSubmitUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setAddState("verifying");
    setError("");

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: new URL(url).hostname.replace("www.", ""),
          sourceUrl: url.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create workspace");
      }

      const data = await response.json();
      setNewWorkspaceId(data.workspace.id);
      setAddState("success");
      onWorkspaceCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setAddState("error");
    }
  };

  const handleStartChat = () => {
    if (newWorkspaceId) {
      router.push(`/chat?workspace=${newWorkspaceId}`);
      handleClose();
    }
  };

  const handleClose = () => {
    setUrl("");
    setAddState("input");
    setError("");
    setNewWorkspaceId(null);
    setActiveTab("select");
    onClose();
  };

  if (!isOpen) return null;

  const readyWorkspaces = workspaces.filter(
    (w) => w.DocSource.status === "ready",
  );
  const indexingStatuses = [
    "pending",
    "scraping",
    "chunking",
    "embedding",
    "storing",
  ];
  const indexingWorkspaces = workspaces.filter((w) =>
    indexingStatuses.includes(w.DocSource.status),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-semibold text-white">New Chat</h2>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleClose}
            className="text-neutral-400 hover:text-white hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setActiveTab("select")}
            className={cn(
              "flex-1 py-3 text-sm font-medium transition-colors",
              activeTab === "select"
                ? "text-white border-b-2 border-emerald-500"
                : "text-neutral-400 hover:text-white",
            )}
          >
            Select Workspace
          </button>
          <button
            onClick={() => setActiveTab("add")}
            className={cn(
              "flex-1 py-3 text-sm font-medium transition-colors",
              activeTab === "add"
                ? "text-white border-b-2 border-emerald-500"
                : "text-neutral-400 hover:text-white",
            )}
          >
            Add New Docs
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Select Workspace Tab */}
          {activeTab === "select" && (
            <div className="space-y-2">
              {workspaces.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
                  <p className="text-neutral-400 text-sm mb-4">
                    No workspaces yet
                  </p>
                  <Button
                    onClick={() => setActiveTab("add")}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Documentation
                  </Button>
                </div>
              ) : (
                <>
                  {/* Ready Workspaces */}
                  {readyWorkspaces.length > 0 && (
                    <div className="space-y-1">
                      {readyWorkspaces.map((workspace) => (
                        <button
                          key={workspace.id}
                          onClick={() => handleSelectWorkspace(workspace)}
                          className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 transition-colors text-left group"
                        >
                          <div className="w-9 h-9 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                            <FileText className="w-4 h-4 text-emerald-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">
                              {workspace.DocSource.productName}
                            </p>
                            <p className="text-neutral-500 text-xs truncate">
                              {workspace.DocSource.chunkCount} chunks indexed
                            </p>
                          </div>
                          <Check className="w-4 h-4 text-emerald-500" />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Indexing Workspaces */}
                  {indexingWorkspaces.length > 0 && (
                    <div className="space-y-1 mt-3">
                      <p className="text-xs text-neutral-500 uppercase tracking-wide px-1 mb-2">
                        Indexing...
                      </p>
                      {indexingWorkspaces.map((workspace) => (
                        <div
                          key={workspace.id}
                          className="w-full flex items-center gap-3 p-3 rounded-lg opacity-60"
                        >
                          <div className="w-9 h-9 bg-blue-500/20 rounded-lg flex items-center justify-center">
                            <FileText className="w-4 h-4 text-blue-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">
                              {workspace.DocSource.productName}
                            </p>
                            <p className="text-neutral-500 text-xs">
                              Indexing in progress...
                            </p>
                          </div>
                          <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Add New Docs Tab */}
          {activeTab === "add" && (
            <>
              {addState === "input" && (
                <form onSubmit={handleSubmitUrl} className="space-y-4">
                  <div>
                    <label className="text-sm text-neutral-400 mb-2 block">
                      Documentation URL
                    </label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                      <Input
                        type="url"
                        placeholder="https://docs.example.com"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-neutral-500"
                        autoFocus
                        required
                      />
                    </div>
                    <p className="text-xs text-neutral-500 mt-2">
                      Enter any documentation URL - we&apos;ll index it and
                      start your chat
                    </p>
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add & Start Chat
                  </Button>
                </form>
              )}

              {addState === "verifying" && (
                <div className="flex flex-col items-center py-8">
                  <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-4" />
                  <p className="text-neutral-400 text-sm">
                    Verifying documentation...
                  </p>
                  <p className="text-neutral-500 text-xs mt-1">
                    This may take a moment
                  </p>
                </div>
              )}

              {addState === "success" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                    <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                      <Check className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div>
                      <p className="text-white font-medium">
                        Documentation Added!
                      </p>
                      <p className="text-neutral-400 text-sm">
                        Indexing started in background
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={handleStartChat}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Start Chatting
                  </Button>
                </div>
              )}

              {addState === "error" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 bg-red-500/10 rounded-xl border border-red-500/20">
                    <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center">
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    </div>
                    <div>
                      <p className="text-white font-medium">Failed</p>
                      <p className="text-neutral-400 text-sm">{error}</p>
                    </div>
                  </div>
                  <Button
                    onClick={() => setAddState("input")}
                    className="w-full bg-white/10 hover:bg-white/15 text-white"
                  >
                    Try Again
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
