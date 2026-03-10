"use client";

import { useState, useEffect } from "react";
import { Plus, FolderOpen, Zap, Crown, BookOpen, LayoutGrid } from "lucide-react";
import { WorkspaceCard } from "./WorkspaceCard";
import { AddWorkspaceModal } from "./AddWorkspaceModal";
import { DocCatalog } from "./DocCatalog";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

type ActiveTab = "my" | "browse";

interface Workspace {
  id: string;
  name: string;
  docSourceId: string;
  lastSeenChangeAt?: string | null;
  canResume?: boolean;
  DocSource: {
    id: string;
    productName: string;
    rootUrl: string;
    status: "pending" | "indexing" | "ready" | "error";
    documentCount: number;
    chunkCount: number;
    lastIndexedAt: string | null;
    lastChangeAt?: string | null;
    changeDescription?: string | null;
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
  const [activeTab, setActiveTab] = useState<ActiveTab>("my");

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
            <h1 className="text-xl font-semibold text-white tracking-tight">
              {activeTab === "my" ? "My Workspaces" : "Browse Docs"}
            </h1>
            {usage && activeTab === "my" && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium border rounded ${
                  usage.isPro
                    ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
                    : "text-neutral-500 border-white/10 bg-white/[0.03]"
                }`}
              >
                {usage.isPro ? <Crown className="w-2.5 h-2.5" /> : <Zap className="w-2.5 h-2.5" />}
                {usage.plan}
              </span>
            )}
          </div>
          <p className="text-sm text-neutral-500">
            {activeTab === "my"
              ? usage
                ? `${usage.count} / ${usage.limit} workspaces used`
                : "Your indexed documentation sources"
              : "Already-indexed docs — start chatting instantly"}
          </p>
        </div>

        {activeTab === "my" && (
          <button
            onClick={() => setShowModal(true)}
            disabled={!canAddWorkspace}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border rounded-md transition-colors ${
              canAddWorkspace
                ? "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600"
                : "bg-transparent text-neutral-600 border-white/10 cursor-not-allowed"
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            {canAddWorkspace ? "Add Workspace" : "Limit Reached"}
          </button>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex items-center border-b border-white/[0.06] mb-6">
        <button
          onClick={() => setActiveTab("my")}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
            activeTab === "my"
              ? "text-white border-emerald-500"
              : "text-neutral-500 border-transparent hover:text-neutral-300",
          )}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          My Workspaces
        </button>
        <button
          onClick={() => setActiveTab("browse")}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
            activeTab === "browse"
              ? "text-white border-emerald-500"
              : "text-neutral-500 border-transparent hover:text-neutral-300",
          )}
        >
          <BookOpen className="w-3.5 h-3.5" />
          Browse Docs
        </button>
      </div>

      {/* ── My Workspaces tab ── */}
      {activeTab === "my" && (
        <>
          {/* Limit reached banner */}
          {usage?.isReached && !usage?.isPro && (
            <div className="mb-6 p-4 border border-amber-500/20 bg-amber-500/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <p className="text-sm text-white">Workspace limit reached</p>
                  <p className="text-xs text-neutral-500">
                    Upgrade to Pro to add more sources
                  </p>
                </div>
              </div>
              <button
                onClick={() =>
                  window.open(
                    `/api/checkout?products=${process.env.NEXT_PUBLIC_POLAR_PRICE_ID || ""}`,
                    "_self",
                  )
                }
                className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              >
                Upgrade
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : workspaces.length === 0 ? (
            <div className="border border-white/[0.06] border-dashed p-16 flex flex-col items-center text-center">
              <FolderOpen className="w-6 h-6 text-neutral-600 mb-6" />
              <p className="text-xs text-neutral-600 mb-3">
                No workspaces yet
              </p>
              <p className="text-sm text-neutral-400 mb-1">
                Add your first documentation source to start chatting
              </p>
              <p className="text-xs text-neutral-600 mb-8">
                Or{" "}
                <button
                  onClick={() => setActiveTab("browse")}
                  className="text-emerald-500 hover:text-emerald-400 transition-colors"
                >
                  browse already-indexed docs
                </button>
                {" "}and start instantly
              </p>
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md bg-white text-black hover:bg-neutral-200 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Your First Workspace
              </button>
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
                  lastChangeAt={workspace.DocSource.lastChangeAt}
                  changeDescription={workspace.DocSource.changeDescription}
                  lastSeenChangeAt={workspace.lastSeenChangeAt}
                  canResume={workspace.canResume}
                  onStartIndexing={() => handleStartIndexing(workspace.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Browse Docs tab ── */}
      {activeTab === "browse" && <DocCatalog />}

      {/* Modal */}
      <AddWorkspaceModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={handleWorkspaceCreated}
      />
    </div>
  );
}
