"use client";

import Link from "next/link";
import {
  FileText,
  ExternalLink,
  Loader2,
  CheckCircle,
  RefreshCw,
  AlertTriangle,
  RefreshCcw,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDocSourceStatus } from "@/lib/hooks/useDocSourceStatus";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";

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
  lastChangeAt?: string | null;
  changeDescription?: string | null;
  lastSeenChangeAt?: string | null;
  canResume?: boolean;
  onStartIndexing?: () => void | Promise<void>;
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
  lastChangeAt,
  changeDescription,
  lastSeenChangeAt,
  canResume = false,
  onStartIndexing,
}: WorkspaceCardProps) {
  const [reindexing, setReindexing] = useState(false);
  const [startingIndexing, setStartingIndexing] = useState(false);
  const [reindexError, setReindexError] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [reindexMessageVisible, setReindexMessageVisible] = useState(false);
  const reindexTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only true when user explicitly clicked Re-index THIS session
  const reindexTriggeredRef = useRef(false);
  // Track previous dynamic status to detect ready transition
  const prevDynamicStatusRef = useRef<string | null>(null);

  // Use polling hook for real-time status
  const {
    status: dynamicStatus,
    statusMessage: dynamicStatusMessage,
    documentCount: dynamicDocumentCount,
    chunkCount: dynamicChunkCount,
    isLoading,
    startPolling,
  } = useDocSourceStatus(docSourceId);

  // Determine effective values
  const status = dynamicStatus || initialStatus;
  const statusMessage = dynamicStatusMessage || initialStatusMessage;
  const documentCount = dynamicDocumentCount ?? initialDocumentCount;
  const chunkCount = dynamicChunkCount ?? initialChunkCount;

  // Banner: show if lastChangeAt is newer than lastSeenChangeAt
  const showChangeBanner =
    !bannerDismissed &&
    status === "ready" &&
    lastChangeAt &&
    (!lastSeenChangeAt || new Date(lastChangeAt) > new Date(lastSeenChangeAt));

  // Show re-index complete message only when user triggered a re-index THIS session
  useEffect(() => {
    if (reindexTriggeredRef.current && dynamicStatus === "ready") {
      reindexTriggeredRef.current = false;
      if (reindexTimerRef.current) clearTimeout(reindexTimerRef.current);
      setReindexMessageVisible(true);
      reindexTimerRef.current = setTimeout(() => setReindexMessageVisible(false), 5000);
    }
    return () => {
      if (reindexTimerRef.current) clearTimeout(reindexTimerRef.current);
    };
  }, [dynamicStatus]);

  // Option A: fire a toast when indexing transitions to ready while tab is open
  useEffect(() => {
    const prev = prevDynamicStatusRef.current;
    if (
      prev !== null &&
      isIndexingStatus(prev) &&
      dynamicStatus === "ready"
    ) {
      const isReindex = reindexTriggeredRef.current;
      toast.success(`${productName} is ready!`, {
        description: isReindex
          ? "Re-index complete. Your docs are up to date."
          : "Indexing complete. Start chatting now.",
        duration: 8000,
      });
    }
    prevDynamicStatusRef.current = dynamicStatus;
  }, [dynamicStatus, productName]);

  // Auto-dismiss docs updated banner after 8 seconds
  useEffect(() => {
    if (showChangeBanner) {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => handleDismissBanner(), 8000);
    }
    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showChangeBanner]);

  // Relative time helper
  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  const handleDismissBanner = async () => {
    setBannerDismissed(true);
    try {
      await fetch(`/api/workspaces/${id}/seen`, { method: "POST" });
    } catch {
      // Fire-and-forget — UI already updated
    }
  };

  // Handler for re-indexing
  const handleReindex = async () => {
    setReindexing(true);
    setReindexError(null);

    try {
      const response = await fetch(`/api/workspaces/${id}/index`, {
        method: "POST",
      });

      if (response.status === 429) {
        const data = await response.json();
        setReindexError(
          `Re-index limit reached (${data.used}/${data.limit}). Resets ${new Date(data.resetsAt).toLocaleDateString()}.`,
        );
        setReindexing(false);
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        setReindexError(data.error || "Re-index failed");
        setReindexing(false);
        return;
      }

      // Success — mark that a re-index was triggered this session, then start polling
      reindexTriggeredRef.current = true;
      startPolling();
    } catch {
      setReindexError("Network error. Please try again.");
    } finally {
      setReindexing(false);
    }
  };

  // Handler to trigger API call THEN start polling (order matters!)
  const handleStartIndexing = async () => {
    setStartingIndexing(true);
    try {
      if (onStartIndexing) {
        await onStartIndexing(); // Wait for API to update DB status first
      }
      startPolling(); // Now polling will see the new "pending" status, not stale "error"
    } finally {
      setStartingIndexing(false);
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

      {/* Doc-changed banner */}
      {showChangeBanner && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <RefreshCcw className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="text-xs text-indigo-300 truncate">
              Docs updated
              {changeDescription && ` · ${changeDescription}`}
              {lastChangeAt && ` · ${timeAgo(lastChangeAt)}`}
            </span>
          </div>
          <button
            onClick={handleDismissBanner}
            className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-200 shrink-0"
          >
            Got it
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Status Message */}
      {(isIndexingStatus(status) || status === "error") && statusMessage && (
        <div
          title={statusMessage}
          className={cn(
            "mb-3 text-xs line-clamp-2",
            status === "error" ? "text-red-400" : "text-blue-400",
          )}
        >
          {statusMessage}
        </div>
      )}

      {/* Re-index success message (shown when ready + has message about re-index, auto-hides after 5s) */}
      {reindexMessageVisible &&
        status === "ready" &&
        statusMessage &&
        statusMessage.includes("Re-index") && (
          <div className="mb-3 text-xs text-emerald-400 bg-emerald-500/5 rounded-lg px-3 py-2 border border-emerald-500/10">
            ✓ {statusMessage}
          </div>
        )}

      {/* Re-index error */}
      {reindexError && (
        <div className="mb-3 text-xs text-amber-400 bg-amber-500/5 rounded-lg px-3 py-2 border border-amber-500/10 flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>{reindexError}</span>
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
          <>
            <Button
              asChild
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              <Link href={`/chat?workspace=${id}`}>Open Chat</Link>
            </Button>
            <Button
              onClick={handleReindex}
              disabled={reindexing || isIndexingStatus(status)}
              variant="outline"
              className="border-white/10 text-neutral-300 hover:text-white hover:bg-white/5 gap-1.5"
              title="Smart re-index: only re-embeds changed pages"
            >
              <RefreshCw
                className={cn("w-3.5 h-3.5", reindexing && "animate-spin")}
              />
              <span className="hidden sm:inline">Re-Index</span>
            </Button>
          </>
        ) : status === "error" ? (
          <Button
            onClick={handleStartIndexing}
            disabled={startingIndexing}
            className={`flex-1 gap-2 ${
              startingIndexing
                ? "opacity-60 cursor-not-allowed"
                : canResume
                  ? "bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400"
                  : "bg-red-500/20 hover:bg-red-500/30 text-red-400"
            }`}
            title={
              canResume
                ? "Resume from last checkpoint (skips completed steps)"
                : "Retry indexing from scratch"
            }
          >
            {startingIndexing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {canResume ? "Resuming..." : "Retrying..."}
              </>
            ) : canResume ? (
              <>
                <RotateCcw className="w-3.5 h-3.5" />
                Resume
              </>
            ) : (
              "Retry"
            )}
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
