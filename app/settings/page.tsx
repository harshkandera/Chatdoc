"use client";

import { useState, useEffect } from "react";
import { UserProfile, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, CreditCard, ExternalLink, Zap } from "lucide-react";
import { UpgradeModal } from "@/components/chat/UpgradeModal";

interface SubscriptionUsage {
  isPro: boolean;
  plan: string;
  count: number;
  limit: number;
  isReached: boolean;
}

export default function SettingsPage() {
  const { user } = useUser();
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  useEffect(() => {
    async function fetchUsage() {
      try {
        const response = await fetch("/api/subscription/usage");
        if (response.ok) {
          const data = await response.json();
          setUsage(data);
        }
      } catch (error) {
        console.error("Failed to fetch usage:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchUsage();
  }, []);

  const handleManageSubscription = (e: React.MouseEvent) => {
    e.preventDefault();
    setPortalLoading(true);
    window.location.href = "/api/billing/portal";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-neutral-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-10">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
        <p className="text-neutral-400">
          Manage your account settings and subscription.
        </p>
      </div>

      {/* Subscription Section (Top Priority) */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <CardTitle className="text-xl text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Subscription & Billing
          </CardTitle>
          <CardDescription className="text-neutral-400">
            Manage your plan, billing details, and invoices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="p-4 rounded-xl bg-black/20 border border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-neutral-400 uppercase tracking-wider font-semibold mb-1">
                  Current Plan
                </p>
                <div className="flex items-center gap-2">
                  <h3 className="text-2xl font-bold text-white">
                    {usage?.plan} Plan
                  </h3>
                  {usage?.isPro && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs border border-emerald-500/30">
                      Active
                    </span>
                  )}
                </div>
              </div>

              {!usage?.isPro ? (
                <Button
                  onClick={() => setShowUpgradeModal(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Upgrade to Pro
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={handleManageSubscription}
                  disabled={portalLoading}
                  className="border-white/10 text-white hover:bg-white/5"
                >
                  {portalLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <ExternalLink className="w-4 h-4 mr-2" />
                  )}
                  Manage Subscription
                </Button>
              )}
            </div>

            {/* Usage Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-neutral-300">Workspace Usage</span>
                <span
                  className={
                    usage?.isReached ? "text-red-400" : "text-neutral-400"
                  }
                >
                  {usage?.count} / {usage?.limit} workspaces used
                </span>
              </div>
              <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    usage?.isPro ? "bg-emerald-500" : "bg-blue-500"
                  } ${usage?.isReached && "bg-red-500"}`}
                  style={{
                    width: `${Math.min(((usage?.count || 0) / (usage?.limit || 1)) * 100, 100)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-neutral-500">
                {usage?.isPro
                  ? "You have access to extended limits with the Pro plan."
                  : "Upgrade to Pro for unlimited workspaces and priority support."}
              </p>
            </div>
          </div>

          {usage?.isPro && (
            <div className="text-sm text-neutral-400">
              <p>
                To manage invoices and payment methods, visit the Polar Billing
                Portal.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Account Management via Clerk */}
      <div className="rounded-xl overflow-hidden border border-white/10">
        <UserProfile
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "w-full shadow-none bg-transparent border-none",
              navbar: "hidden",
              navbarMobileMenuButton: "hidden",
              headerTitle: "text-xl text-white",
              headerSubtitle: "text-neutral-400",
            },
          }}
        />
      </div>

      <UpgradeModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </div>
  );
}
