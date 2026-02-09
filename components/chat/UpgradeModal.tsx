"use client";

import { Check, X, Zap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function UpgradeModal({ isOpen, onClose }: UpgradeModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 opacity-50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-neutral-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Glow Effect */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-20 bg-emerald-500/20 blur-[50px] pointer-events-none" />

        <div className="relative p-8">
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-4 right-4 text-neutral-400 hover:text-white"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>

          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-12 h-12 bg-emerald-500/20 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-emerald-500/40">
              <Zap className="w-6 h-6 text-emerald-400 fill-emerald-400" />
            </div>

            <h2 className="text-2xl font-semibold text-white mb-2">
              Upgrade to Pro
            </h2>
            <p className="text-neutral-400 text-sm max-w-sm">
              You&apos;ve reached the limit of free workspaces. Unlock unlimited
              power for just $19/mo.
            </p>
          </div>

          <div className="space-y-4 mb-8 bg-white/5 rounded-xl p-4 border border-white/5">
            {[
              "Unlimited Documentation Sources",
              "Priority Indexing Speed",
              "Advanced RAG (Better Answers)",
              "Priority Support Channel",
            ].map((feature) => (
              <div
                key={feature}
                className="flex items-center gap-3 text-sm text-neutral-300"
              >
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-emerald-400" />
                </div>
                {feature}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <Link
              href={`/api/checkout?products=${
                process.env.NEXT_PUBLIC_POLAR_PRICE_ID || ""
              }`}
              className="w-full py-3 bg-white text-black font-semibold rounded-xl text-center hover:bg-neutral-200 transition-colors"
            >
              Upgrade Now
            </Link>
            <button
              onClick={onClose}
              className="text-xs text-neutral-500 hover:text-white transition-colors"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
