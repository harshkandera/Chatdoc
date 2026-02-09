"use client";

import { useState, useEffect } from "react";
import { Plus, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspaceCard, AddWorkspaceModal } from "@/components/workspace";
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

export default function WorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

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

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const handleStartIndexing = async (workspaceId: string) => {
    try {
      await fetch(`/api/workspaces/${workspaceId}/index`, {
        method: "POST",
      });
      // Refresh workspaces to get updated status
      fetchWorkspaces();
    } catch (error) {
      console.error("Failed to start indexing:", error);
    }
  };

  const handleWorkspaceCreated = (result: { workspace: { id: string } }) => {
    fetchWorkspaces();
    router.push(`/chat?workspace=${result.workspace.id}`);
  };

  return (
    <div className="min-h-screen bg-black">
      {/* Background */}
      <div className="fixed inset-0 technical-grid opacity-50" />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Workspaces</h1>
            <p className="text-neutral-400">
              Your indexed documentation sources
            </p>
          </div>
          <Button
            onClick={() => setShowModal(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Workspace
          </Button>
        </div>

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
      </div>

      {/* Modal */}
      <AddWorkspaceModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={handleWorkspaceCreated}
      />
    </div>
  );
}
