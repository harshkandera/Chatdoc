"use client";

import { useState, useEffect } from "react";
import { Plus, FolderOpen, Zap, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspaceCard } from "./WorkspaceCard";
import { AddWorkspaceModal } from "./AddWorkspaceModal";
import { useRouter } from "next/navigation";

interface Workspace {
  id: string;
  name: string;
  docSourceId: string;
  DocSource: {
    id: string;
    productName: string;
    rootUrl: string;
    status: "pending" | "indexing" | "ready" | "error";
    documentCount: number;
    chunkCount: number;
    lastIndexedAt: string | null;
  };
}

interface PlanUsage {
  isPro: boolean;
  plan: string;
  count: number;
  limit: number;
  isReached: boolean;
}

export function WorkspacePanel() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [usage, setUsage] = useState<PlanUsage | null>(null);

  const fetchWorkspaces = async () => {
    try {
      const response = await fetch("/api/workspaces");
      if (response.ok) {
        const data = await response.json();
        setWorkspaces(data);
      }
    } catch (error) {
      console.error("Failed to fetch workspaces:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsage = async () => {
    try {
      const response = await fetch("/api/subscription/usage");
      if (response.ok) {
        const data = await response.json();
        setUsage(data);
      }
    } catch (error) {
      console.error("Failed to fetch usage:", error);
    }
  };

  useEffect(() => {
    fetchWorkspaces();
    fetchUsage();
  }, []);

  const handleStartIndexing = async (workspaceId: string) => {
    try {
      await fetch(`/api/workspaces/${workspaceId}/index`, {
        method: "POST",
      });
      fetchWorkspaces();
    } catch (error) {
      console.error("Failed to start indexing:", error);
    }
  };

  const handleWorkspaceCreated = (result: { workspace: { id: string } }) => {
    fetchWorkspaces();
    fetchUsage();
    router.push(`/chat?workspace=${result.workspace.id}`);
  };

  const canAddWorkspace = !usage?.isReached;

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold text-white">All Workspaces</h1>
            {usage && (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                  usage.isPro
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-white/5 text-neutral-400 border-white/10"
                }`}
              >
                {usage.isPro ? (
                  <Crown className="w-3 h-3" />
                ) : (
                  <Zap className="w-3 h-3" />
                )}
                {usage.plan}
              </span>
            )}
          </div>
          <p className="text-sm text-neutral-400">
            {usage
              ? `${usage.count} / ${usage.limit} workspaces used`
              : "Your indexed documentation sources"}
          </p>
        </div>
        <Button
          onClick={() => setShowModal(true)}
          disabled={!canAddWorkspace}
          className={
            canAddWorkspace
              ? "bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
              : "bg-white/5 text-neutral-500 cursor-not-allowed gap-2"
          }
        >
          <Plus className="w-4 h-4" />
          {canAddWorkspace ? "Add Workspace" : "Limit Reached"}
        </Button>
      </div>

      {/* Limit reached banner */}
      {usage?.isReached && !usage?.isPro && (
        <div className="mb-6 p-4 rounded-xl bg-amber-500/5 border border-amber-500/15 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-500/20 rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                Workspace limit reached
              </p>
              <p className="text-xs text-neutral-400">
                Upgrade to Pro to add more documentation sources
              </p>
            </div>
          </div>
          <Button
            onClick={() =>
              window.open(
                `/api/checkout?products=${process.env.NEXT_PUBLIC_POLAR_PRICE_ID || ""}`,
                "_self",
              )
            }
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
          >
            Upgrade
          </Button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FolderOpen className="w-8 h-8 text-neutral-500" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">
            No workspaces yet
          </h3>
          <p className="text-neutral-400 mb-6 max-w-md mx-auto">
            Add your first documentation source to start chatting with it
          </p>
          <Button
            onClick={() => setShowModal(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Your First Workspace
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {workspaces.map((workspace) => (
            <WorkspaceCard
              key={workspace.id}
              id={workspace.id}
              docSourceId={workspace.docSourceId}
              name={workspace.name}
              productName={workspace.DocSource.productName}
              rootUrl={workspace.DocSource.rootUrl}
              status={workspace.DocSource.status}
              documentCount={workspace.DocSource.documentCount}
              chunkCount={workspace.DocSource.chunkCount}
              lastIndexedAt={workspace.DocSource.lastIndexedAt || undefined}
              onStartIndexing={() => handleStartIndexing(workspace.id)}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      <AddWorkspaceModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={handleWorkspaceCreated}
      />
    </div>
  );
}
