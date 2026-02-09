"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import {
  FileText,
  Plus,
  MessageSquare,
  Settings,
  Zap,
  HelpCircle,
  PanelLeftClose,
  PanelLeft,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUser } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { AddWorkspaceModal } from "@/components/workspace";
import { NewChatModal } from "./NewChatModal";
import { UpgradeModal } from "./UpgradeModal";
import Logo from "@/public/log.png";
import Image from "next/image";

interface Chat {
  id: string;
  title: string;
  workspaceId: string;
  createdAt: string;
}

interface Workspace {
  id: string;
  name: string;
  DocSource: {
    productName: string;
    rootUrl: string;
    status: string;
    statusMessage: string | null;
    chunkCount: number;
  };
  chats?: Chat[];
}

interface SubscriptionUsage {
  isPro: boolean;
  plan: string;
  count: number;
  limit: number;
  isReached: boolean;
}

// Helper to check if a workspace is actively indexing
const isIndexingStatus = (status: string) =>
  ["pending", "scraping", "chunking", "embedding", "storing"].includes(status);

const accountItems = [
  {
    icon: FolderOpen,
    label: "All Workspaces",
    href: "/chat?view=workspaces",
  },
  { icon: Settings, label: "Preferences", href: "/settings" },
  {
    icon: HelpCircle,
    label: "Help & Feedback",
    href: "mailto:support@chatdoc.com",
  },
];

export function ChatSidebar() {
  const { user } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null);

  // Fetch usage data
  const fetchUsage = useCallback(async () => {
    try {
      const response = await fetch("/api/subscription/usage");
      if (response.ok) {
        const data = await response.json();
        setUsage(data);
      }
    } catch (error) {
      console.error("Failed to fetch usage:", error);
    }
  }, []);

  // Fetch workspaces with their chats
  const fetchWorkspaces = useCallback(async () => {
    try {
      const response = await fetch("/api/workspaces");
      if (response.ok) {
        const data = await response.json();
        setWorkspaces(data);
        // Auto-expand first workspace on first load
        setExpandedWorkspaces((current) => {
          if (current.size === 0 && data.length > 0) {
            return new Set([data[0].id]);
          }
          return current;
        });
      }
    } catch (error) {
      console.error("Failed to fetch workspaces:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
    fetchUsage();

    // Listen for new chat creation
    const handleChatCreated = () => {
      console.log(
        "[ChatSidebar] Chat created event received, refreshing in 500ms...",
      );
      setTimeout(() => {
        fetchWorkspaces();
        fetchUsage();
      }, 500);
    };

    window.addEventListener("chat-created", handleChatCreated);

    return () => {
      window.removeEventListener("chat-created", handleChatCreated);
    };
  }, [fetchWorkspaces, fetchUsage]);

  // Track which IDs we are currently polling
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set());

  // Initialize polling IDs when workspaces change
  useEffect(() => {
    console.log("[Polling] Workspaces changed, recalculating pollingIds...");
    setPollingIds((currentIds) => {
      const nextIds = new Set(currentIds);
      let changed = false;

      workspaces.forEach((w) => {
        const isIndexing = isIndexingStatus(w.DocSource.status);
        const istracked = nextIds.has(w.id);

        console.log(
          `[Polling] Workspace ${w.id}: status=${w.DocSource.status}, isIndexing=${isIndexing}, tracked=${istracked}`,
        );

        if (isIndexing && !istracked) {
          nextIds.add(w.id);
          changed = true;
          console.log(`[Polling] ✅ Added ${w.id} to polling`);
        } else if (!isIndexing && istracked) {
          nextIds.delete(w.id);
          changed = true;
          console.log(`[Polling] ✅ Removed ${w.id} from polling`);
        }
      });

      console.log(
        `[Polling] Total pollingIds: ${nextIds.size}, changed: ${changed}`,
      );
      return changed ? nextIds : currentIds;
    });
  }, [workspaces]);

  // Lightweight status polling
  const pollStatus = useCallback(async () => {
    if (pollingIds.size === 0) return;

    try {
      const idsToPoll = Array.from(pollingIds);
      console.log(`[Polling] Fetching status for: ${idsToPoll.join(",")}`);

      const response = await fetch(
        `/api/workspaces/status?ids=${idsToPoll.join(",")}`,
      );

      if (response.ok) {
        const statuses = await response.json();
        console.log("[Polling] Received statuses:", statuses);

        setWorkspaces((prev) =>
          prev.map((w) => {
            const updated = statuses.find((s: { id: string }) => s.id === w.id);
            if (updated) {
              console.log(
                `[Polling] Updated ${w.id}: ${w.DocSource.status} → ${updated.DocSource.status}`,
              );
              // If status changed to done, remove from polling list on next effect cycle
              return {
                ...w,
                DocSource: {
                  ...w.DocSource,
                  status: updated.DocSource.status,
                  statusMessage: updated.DocSource.statusMessage,
                },
              };
            }
            return w;
          }),
        );
      } else {
        console.error(`[Polling] API returned status ${response.status}`);
      }
    } catch (error) {
      console.error("[Polling] Failed to fetch status:", error);
    }
  }, [pollingIds]);

  // Effect to run the polling interval
  useEffect(() => {
    if (pollingIds.size === 0) {
      console.log("[Polling] No workspaces to poll, stopping");
      return;
    }

    console.log(
      `[Polling] Starting poll interval for ${pollingIds.size} workspace(s)`,
    );

    // Poll immediately
    pollStatus();

    const interval = setInterval(() => {
      console.log(`[Polling] Polling ${pollingIds.size} workspace(s)...`);
      pollStatus();
    }, 2000);

    return () => {
      console.log("[Polling] Clearing interval");
      clearInterval(interval);
    };
  }, [pollingIds, pollStatus]);

  const toggleWorkspace = (workspaceId: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  };

  const handleWorkspaceCreated = async (result: {
    workspace: { id: string; name: string; docSourceId: string };
    docSource: {
      id: string;
      productName: string;
      rootUrl: string;
      status: string;
    };
    isNewDocSource: boolean;
  }) => {
    console.log("[ChatSidebar] Workspace created:", {
      workspaceId: result.workspace.id,
      docSourceStatus: result.docSource.status,
      isNewDocSource: result.isNewDocSource,
    });

    // FIX #1: Optimistically add workspace to state with "pending" status
    // This immediately starts polling without waiting for fetchWorkspaces
    const optimisticStatus = result.isNewDocSource
      ? "pending"
      : result.docSource.status;
    console.log("[ChatSidebar] Setting optimistic status:", optimisticStatus);

    setWorkspaces((prev) => {
      const newWorkspaces = [
        {
          id: result.workspace.id,
          name: result.workspace.name,
          DocSource: {
            productName: result.docSource.productName,
            rootUrl: result.docSource.rootUrl,
            status: optimisticStatus,
            statusMessage: result.isNewDocSource
              ? "Preparing to index documentation..."
              : null,
            chunkCount: 0,
          },
          chats: [],
        },
        ...prev,
      ];
      console.log(
        "[ChatSidebar] Updated workspaces count:",
        newWorkspaces.length,
      );
      return newWorkspaces;
    });

    // Auto-expand the new workspace
    setExpandedWorkspaces((current) => {
      const next = new Set([...current, result.workspace.id]);
      console.log("[ChatSidebar] Expanded workspaces:", Array.from(next));
      return next;
    });

    // Then refresh from server (in background) for full sync
    fetchWorkspaces();
    fetchUsage(); // Refresh usage limits

    router.push(`/chat?workspace=${result.workspace.id}`);
    setShowAddModal(false);
  };

  const handleAddNew = () => {
    if (usage?.isReached) {
      setShowUpgradeModal(true);
    } else {
      setShowAddModal(true);
    }
  };

  return (
    <>
      <aside
        className={cn(
          "flex flex-col h-full bg-black/40 backdrop-blur-xl border-r border-white/[0.08] transition-all duration-300",
          collapsed ? "w-16" : "w-72",
        )}
      >
        {/* Header: Logo + Collapse */}
        <div className="flex items-center justify-between p-4 h-14 flex-shrink-0">
          {!collapsed && (
            <Link href="/" className="flex items-center gap-2">
              <Image src={Logo} alt="Logo" width={28} height={28} />
              <span className="text-sm font-semibold text-white">ChatDoc</span>
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCollapsed(!collapsed)}
            className="text-neutral-400 hover:text-white hover:bg-white/5 ml-auto"
          >
            {collapsed ? (
              <PanelLeft className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </Button>
        </div>

        {/* New Chat Button */}
        <div className="px-3 mb-4 flex-shrink-0">
          <Button
            onClick={() => setShowNewChatModal(true)}
            className={cn(
              "w-full bg-white/[0.08] hover:bg-white/[0.12] text-white border border-white/[0.08] justify-start gap-2",
              collapsed && "justify-center px-0",
            )}
          >
            <Plus className="w-4 h-4" />
            {!collapsed && <span>New Chat</span>}
          </Button>
        </div>

        {/* SCROLLABLE WORKSPACES SECTION */}
        <ScrollArea className="flex-1 overflow-hidden">
          {!collapsed && (
            <>
              {/* Workspaces Section */}
              <div className="px-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-medium text-neutral-500 uppercase tracking-wider px-2">
                    Workspaces
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleAddNew}
                    className="w-5 h-5 text-neutral-500 hover:text-white hover:bg-white/5"
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-4 h-4 text-neutral-500 animate-spin" />
                  </div>
                ) : workspaces.length === 0 ? (
                  <button
                    onClick={handleAddNew}
                    className="flex items-center gap-2 w-full px-2 py-3 rounded-lg text-sm text-neutral-400 hover:text-white hover:bg-white/[0.04] transition-colors border border-dashed border-white/10"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>Add your first workspace</span>
                  </button>
                ) : (
                  <div className="space-y-1 mb-6">
                    {workspaces.map((workspace) => (
                      <div key={workspace.id}>
                        {/* Workspace Header */}
                        <button
                          onClick={() => toggleWorkspace(workspace.id)}
                          className={cn(
                            "flex items-center gap-2 w-full px-2 py-2 rounded-lg text-sm text-neutral-400 hover:text-white hover:bg-white/[0.04] transition-colors",
                          )}
                        >
                          {expandedWorkspaces.has(workspace.id) ? (
                            <ChevronDown className="w-3 h-3 shrink-0" />
                          ) : (
                            <ChevronRight className="w-3 h-3 shrink-0" />
                          )}
                          <FileText className="w-4 h-4 shrink-0 text-emerald-500" />
                          <span className="truncate flex-1 text-left">
                            {workspace.DocSource.productName}
                          </span>
                          {isIndexingStatus(workspace.DocSource.status) && (
                            <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                          )}
                        </button>

                        {/* Status message during indexing */}
                        {isIndexingStatus(workspace.DocSource.status) &&
                          workspace.DocSource.statusMessage && (
                            <div className="ml-7 px-2 py-1 text-[10px] text-blue-400 truncate">
                              {workspace.DocSource.statusMessage}
                            </div>
                          )}

                        {/* Workspace Chats */}
                        {expandedWorkspaces.has(workspace.id) && (
                          <div className="ml-5 pl-2 border-l border-white/[0.06] space-y-0.5">
                            {workspace.chats &&
                              workspace.chats.length > 0 &&
                              workspace.chats.slice(0, 5).map((chat) => (
                                <Link
                                  key={chat.id}
                                  href={`/chat/${chat.id}`}
                                  className={cn(
                                    "flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-neutral-500 hover:text-white hover:bg-white/[0.04] transition-colors",
                                    pathname === `/chat/${chat.id}` &&
                                      "bg-white/[0.06] text-white",
                                  )}
                                >
                                  <MessageSquare className="w-3 h-3 shrink-0" />
                                  <span className="truncate">{chat.title}</span>
                                </Link>
                              ))}
                            {/* New Chat link */}
                            <Link
                              href={`/chat?workspace=${workspace.id}`}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-neutral-500 hover:text-emerald-400 transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                              <span>New chat</span>
                            </Link>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <Separator className="bg-white/[0.06] mb-4" />
              </div>
            </>
          )}
        </ScrollArea>

        {/* FIXED BOTTOM SECTION - Quick Links + Account */}
        {!collapsed && (
          <>
            <div className="px-3 py-4 flex-shrink-0">
              <div className="space-y-0.5">
                {accountItems.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-sm text-neutral-400 hover:text-white hover:bg-white/[0.04] transition-colors"
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>

            <Separator className="bg-white/[0.06]" />

            {/* Usage / Plan Indicator */}
            {usage && (
              <div className="px-3 py-3">
                <div className="flex items-center justify-between mb-2 px-2">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-neutral-500">
                    {usage.plan} Plan
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-mono",
                      usage.isReached ? "text-red-400" : "text-neutral-400",
                    )}
                  >
                    {usage.count} / {usage.limit}
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden mb-2 mx-2 max-w-[calc(100%-16px)]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      usage.isPro ? "bg-emerald-500" : "bg-blue-500",
                      usage.isReached && "bg-red-500",
                    )}
                    style={{
                      width: `${Math.min((usage.count / usage.limit) * 100, 100)}%`,
                    }}
                  />
                </div>

                {!usage.isPro && (
                  <button
                    onClick={() => setShowUpgradeModal(true)}
                    className="w-full text-xs flex items-center justify-center gap-1.5 py-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded-lg transition-colors mt-1"
                  >
                    <Zap className="w-3 h-3" />
                    Upgrade to Pro
                  </button>
                )}
              </div>
            )}

            <Separator className="bg-white/[0.06]" />
          </>
        )}

        {/* FIXED USER PROFILE AT BOTTOM */}
        <div className="p-3 border-t border-white/[0.06] flex-shrink-0">
          <div
            className={cn(
              "flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04] cursor-pointer transition-colors",
              collapsed && "justify-center",
            )}
          >
            <Avatar className="w-8 h-8">
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback className="bg-neutral-700 text-white text-xs">
                {user?.firstName?.[0] || "U"}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {user?.fullName || "User"}
                </p>
                <p className="text-xs text-neutral-500 truncate">
                  {user?.primaryEmailAddress?.emailAddress || "user@email.com"}
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Add Workspace Modal */}
      <AddWorkspaceModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={handleWorkspaceCreated}
      />

      {/* New Chat Modal */}
      <NewChatModal
        isOpen={showNewChatModal}
        onClose={() => setShowNewChatModal(false)}
        workspaces={workspaces}
        onWorkspaceCreated={() => {
          window.location.reload();
          fetchUsage();
        }}
      />

      {/* Upgrade Modal */}
      <UpgradeModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </>
  );
}
