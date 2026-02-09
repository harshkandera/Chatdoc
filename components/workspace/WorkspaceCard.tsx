"use client";

import Link from "next/link";
import { FileText, ExternalLink, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDocSourceStatus } from "@/lib/hooks/useDocSourceStatus";

interface WorkspaceCardProps {
  id: string;
  docSourceId: string;
  name: string;
  productName: string;
  rootUrl: string;
  status: string;
  statusMessage?: string | null;
  documentCount?: number;
  chunkCount?: number;
  lastIndexedAt?: string;
  onStartIndexing?: () => void;
}

// Helper to check if status is an indexing status
const isIndexingStatus = (status: string) =>
  ["pending", "scraping", "chunking", "embedding", "storing"].includes(status);

export function WorkspaceCard({
  id,
  docSourceId,
  name,
  productName,
  rootUrl,
  status: initialStatus,
  statusMessage: initialStatusMessage,
  documentCount: initialDocumentCount = 0,
  chunkCount: initialChunkCount = 0,
  lastIndexedAt,
  onStartIndexing,
}: WorkspaceCardProps) {
  // Use polling hook for real-time status
  const {
    status: dynamicStatus,
    statusMessage: dynamicStatusMessage,
    documentCount: dynamicDocumentCount,
    chunkCount: dynamicChunkCount,
    isLoading,
    startPolling,
  } = useDocSourceStatus(docSourceId); // Use docSourceId (derived from props/workspace)

  // Determine effective values (prefer dynamic if available/loaded, else initial)
  // Logic: Only use dynamic values if they are not null (meaning hook has fetched data)
  const status = dynamicStatus || initialStatus;
  const statusMessage = dynamicStatusMessage || initialStatusMessage;
  const documentCount = dynamicDocumentCount ?? initialDocumentCount;
  const chunkCount = dynamicChunkCount ?? initialChunkCount;

  // Handler to trigger optimistic polling + API call
  const handleStartIndexing = async () => {
    // 1. Immediately start polling (optimistic)
    startPolling();

    // 2. Trigger the actual API call
    if (onStartIndexing) {
      onStartIndexing();
    }
  };

  const statusConfig: Record<
    string,
    { label: string; color: string; bgColor: string; borderColor: string }
  > = {
    pending: {
      label: "Pending",
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
      borderColor: "border-yellow-500/20",
    },
    scraping: {
      label: "Scraping",
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/20",
    },
    chunking: {
      label: "Chunking",
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/20",
    },
    embedding: {
      label: "Embedding",
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
      borderColor: "border-purple-500/20",
    },
    storing: {
      label: "Storing",
      color: "text-indigo-500",
      bgColor: "bg-indigo-500/10",
      borderColor: "border-indigo-500/20",
    },
    ready: {
      label: "Ready",
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/20",
    },
    error: {
      label: "Error",
      color: "text-red-500",
      bgColor: "bg-red-500/10",
      borderColor: "border-red-500/20",
    },
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <div className="glass-card rounded-xl p-5 flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
            <FileText className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h3 className="font-medium text-white">{productName}</h3>
            <p className="text-xs text-neutral-500 truncate max-w-[180px]">
              {name}
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <div
          className={cn(
            "px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1",
            config.bgColor,
            config.borderColor,
            "border",
          )}
        >
          {isIndexingStatus(status) && (
            <Loader2 className="w-3 h-3 animate-spin" />
          )}
          {status === "ready" && <CheckCircle className="w-3 h-3" />}
          <span className={config.color}>{config.label}</span>
        </div>
      </div>

      {/* Status Message */}
      {isIndexingStatus(status) && statusMessage && (
        <div className="mb-3 text-xs text-blue-400 truncate">
          {statusMessage}
        </div>
      )}

      {/* URL */}
      <a
        href={rootUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-sm text-neutral-400 hover:text-emerald-400 transition-colors mb-4 truncate"
      >
        <ExternalLink className="w-3 h-3 shrink-0" />
        <span className="truncate">{rootUrl}</span>
      </a>

      {/* Stats */}
      {status === "ready" && (
        <div className="flex gap-4 mb-4 text-sm">
          <div>
            <span className="text-neutral-500">Pages: </span>
            <span className="text-white">{documentCount}</span>
          </div>
          <div>
            <span className="text-neutral-500">Chunks: </span>
            <span className="text-white">{chunkCount}</span>
          </div>
        </div>
      )}

      {/* Last Indexed */}
      {lastIndexedAt && (
        <p className="text-xs text-neutral-500 mb-4">
          Last indexed: {new Date(lastIndexedAt).toLocaleDateString()}
        </p>
      )}

      {/* Actions */}
      <div className="mt-auto pt-4 border-t border-white/6 flex gap-2">
        {status === "ready" ? (
          <Button
            asChild
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            <Link href={`/chat?workspace=${id}`}>Open Chat</Link>
          </Button>
        ) : status === "error" ? (
          <Button
            onClick={handleStartIndexing}
            className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400"
          >
            Retry
          </Button>
        ) : isIndexingStatus(status) ? (
          <Button
            disabled
            className="flex-1 bg-white/5 text-neutral-500 cursor-not-allowed"
          >
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            {status.charAt(0).toUpperCase() + status.slice(1)}...
          </Button>
        ) : (
          <Button
            onClick={handleStartIndexing}
            className="flex-1 bg-white/10 hover:bg-white/15 text-white"
          >
            Start Indexing
          </Button>
        )}
      </div>
    </div>
  );
}
