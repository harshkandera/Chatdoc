"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Search,
  ExternalLink,
  MessageSquare,
  CheckCircle,
  Loader2,
  BookOpen,
  Layers,
  FileCode,
  Library,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

interface DocSource {
  id: string;
  productName: string;
  rootUrl: string;
  canonicalUrl: string;
  docType: string;
  version: string | null;
  description: string | null;
  documentCount: number;
  chunkCount: number;
  lastIndexedAt: string | null;
  changeStrategy: string | null;
  userWorkspaceId: string | null; // null = not added yet
  userCount: number;
}

const DOC_TYPE_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; color: string; bg: string }
> = {
  framework: {
    label: "Framework",
    icon: Layers,
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/20",
  },
  api: {
    label: "API",
    icon: FileCode,
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
  },
  library: {
    label: "Library",
    icon: Library,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  guide: {
    label: "Guide",
    icon: BookOpen,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
  },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function DocCard({
  doc,
  onAdd,
  adding,
}: {
  doc: DocSource;
  onAdd: (doc: DocSource) => void;
  adding: boolean;
}) {
  const router = useRouter();
  const typeConfig =
    DOC_TYPE_CONFIG[doc.docType] || DOC_TYPE_CONFIG.guide;
  const Icon = typeConfig.icon;
  const isAdded = !!doc.userWorkspaceId;

  return (
    <div className="glass-card rounded-xl p-5 flex flex-col gap-4 group">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-white/8 transition-colors">
            <Icon className={cn("w-5 h-5", typeConfig.color)} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium text-white truncate">
                {doc.productName}
              </h3>
              {doc.version && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-neutral-500 border border-white/8 font-mono shrink-0">
                  {doc.version}
                </span>
              )}
            </div>
            <a
              href={doc.rootUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-xs text-neutral-500 hover:text-emerald-400 transition-colors truncate mt-0.5"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              <span className="truncate">{doc.canonicalUrl}</span>
            </a>
          </div>
        </div>

        {/* Type badge */}
        <span
          className={cn(
            "text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0",
            typeConfig.bg,
            typeConfig.color,
          )}
        >
          {typeConfig.label}
        </span>
      </div>

      {/* Description */}
      {doc.description && (
        <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed">
          {doc.description}
        </p>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-neutral-500">
        <span>
          <span className="text-neutral-300 font-medium">{doc.documentCount}</span>{" "}
          pages
        </span>
        <span>
          <span className="text-neutral-300 font-medium">
            {doc.chunkCount.toLocaleString()}
          </span>{" "}
          chunks
        </span>
        {doc.lastIndexedAt && (
          <span className="ml-auto">{timeAgo(doc.lastIndexedAt)}</span>
        )}
      </div>

      {/* Users using this */}
      {doc.userCount > 1 && (
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          <Sparkles className="w-3 h-3 text-emerald-500/60" />
          <span>{doc.userCount} users chatting with this</span>
        </div>
      )}

      {/* Action */}
      {isAdded ? (
        <Button
          onClick={() => router.push(`/chat?workspace=${doc.userWorkspaceId}`)}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white gap-2 mt-auto"
        >
          <MessageSquare className="w-4 h-4" />
          Open Chat
        </Button>
      ) : (
        <Button
          onClick={() => onAdd(doc)}
          disabled={adding}
          className="w-full bg-white/8 hover:bg-white/12 text-white border border-white/8 hover:border-white/15 gap-2 mt-auto transition-all"
        >
          {adding ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <MessageSquare className="w-4 h-4" />
          )}
          {adding ? "Adding..." : "Start Chatting"}
        </Button>
      )}
    </div>
  );
}

export function DocCatalog() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/doc-sources")
      .then((r) => r.json())
      .then((data) => {
        setDocs(Array.isArray(data) ? data : []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search) return docs;
    const q = search.toLowerCase();
    return docs.filter(
      (d) =>
        d.productName.toLowerCase().includes(q) ||
        d.canonicalUrl.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q),
    );
  }, [docs, search]);

  const handleAdd = async (doc: DocSource) => {
    setAddingId(doc.id);
    setError(null);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: doc.productName,
          sourceUrl: doc.rootUrl,
          docSourceId: doc.id,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to add workspace. Please try again.");
        return;
      }

      const data = await res.json();
      // Optimistically mark as added in the list
      setDocs((prev) =>
        prev.map((d) =>
          d.id === doc.id
            ? { ...d, userWorkspaceId: data.workspace.id }
            : d,
        ),
      );
      // Navigate to chat
      router.push(`/chat?workspace=${data.workspace.id}`);
    } catch (e) {
      console.error(e);
    } finally {
      setAddingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Search bar */}
      <div className="relative w-96">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 pointer-events-none" />
        <Input
          placeholder="Search documentation..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-neutral-500"
        />
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Results count */}
      <p className="text-xs text-neutral-500">
        {filtered.length} documentation source{filtered.length !== 1 ? "s" : ""} available
        {search && ` for "${search}"`}
      </p>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-7 h-7 text-neutral-500" />
          </div>
          <p className="text-white font-medium mb-1">No results found</p>
          <p className="text-sm text-neutral-500">
            Try a different search term or filter
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((doc) => (
            <DocCard
              key={doc.id}
              doc={doc}
              onAdd={handleAdd}
              adding={addingId === doc.id}
            />
          ))}
        </div>
      )}

      {/* Already-added section header indicator */}
      {filtered.some((d) => d.userWorkspaceId) && (
        <div className="flex items-center gap-2 text-xs text-neutral-500 mt-2">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
          Docs with "Open Chat" are already in your workspaces
        </div>
      )}
    </div>
  );
}
