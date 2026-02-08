"use client";

import { useState } from "react";
import { X, Loader2, Globe, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AddWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (workspace: WorkspaceResult) => void;
}

interface WorkspaceResult {
  workspace: {
    id: string;
    name: string;
    docSourceId: string;
  };
  docSource: {
    id: string;
    productName: string;
    rootUrl: string;
    status: string;
  };
  isNewDocSource: boolean;
}

type ModalState = "input" | "verifying" | "success" | "error";

export function AddWorkspaceModal({
  isOpen,
  onClose,
  onSuccess,
}: AddWorkspaceModalProps) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<ModalState>("input");
  const [result, setResult] = useState<WorkspaceResult | null>(null);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setState("verifying");
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
      console.log("[AddWorkspaceModal] API Response:", data);
      setResult(data);
      setState("success");
    } catch (err) {
      console.error("[AddWorkspaceModal] Error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  };

  const handleConfirm = () => {
    if (result) {
      onSuccess(result);
      handleClose();
    }
  };

  const handleClose = () => {
    setUrl("");
    setState("input");
    setResult(null);
    setError("");
    onClose();
  };

  const handleRetry = () => {
    setState("input");
    setError("");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 glass-card rounded-2xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white">
            Add Documentation
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleClose}
            className="text-neutral-400 hover:text-white hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Input State */}
        {state === "input" && (
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
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
                    required
                  />
                </div>
                <p className="text-xs text-neutral-500 mt-2">
                  Enter the URL of any documentation site you want to chat with
                </p>
              </div>
              <Button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                Add Workspace
              </Button>
            </div>
          </form>
        )}

        {/* Verifying State */}
        {state === "verifying" && (
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

        {/* Success State */}
        {state === "success" && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
              <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                <Check className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-white font-medium">
                  {result.docSource.productName}
                </p>
                <p className="text-neutral-400 text-sm truncate max-w-[200px]">
                  {result.docSource.rootUrl}
                </p>
              </div>
            </div>

            {result.isNewDocSource ? (
              <p className="text-neutral-400 text-sm text-center">
                Documentation will be indexed in the background. You can start
                chatting once it&apos;s ready.
              </p>
            ) : (
              <p className="text-neutral-400 text-sm text-center">
                This documentation is already indexed and ready to use!
              </p>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleClose}
                className="flex-1 border-white/10 text-neutral-400 hover:text-white hover:bg-white/5"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                Open Workspace
              </Button>
            </div>
          </div>
        )}

        {/* Error State */}
        {state === "error" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-red-500/10 rounded-xl border border-red-500/20">
              <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-white font-medium">Verification Failed</p>
                <p className="text-neutral-400 text-sm">{error}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleClose}
                className="flex-1 border-white/10 text-neutral-400 hover:text-white hover:bg-white/5"
              >
                Cancel
              </Button>
              <Button
                onClick={handleRetry}
                className="flex-1 bg-white/10 hover:bg-white/15 text-white"
              >
                Try Again
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
