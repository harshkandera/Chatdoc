"use client";

import { CheckCircle } from "lucide-react";
import Link from "next/link";
import { AuraBackground } from "@/components/AuraBackground";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SuccessContent() {
  const searchParams = useSearchParams();
  const checkoutId = searchParams.get("checkoutId");

  return (
    <div className="bg-neutral-900/10 border border-white/5 backdrop-blur-xl p-12 rounded-3xl max-w-lg w-full spotlight-card relative overflow-hidden group">
      {/* Success Icon */}
      <div className="mb-8 flex justify-center">
        <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(16,185,129,0.3)] animate-pulse">
          <CheckCircle className="w-10 h-10 text-emerald-500" />
        </div>
      </div>

      <h1 className="text-3xl md:text-4xl font-semibold text-white mb-4 tracking-tight">
        You&apos;re all set!
      </h1>

      <p className="text-neutral-400 mb-8 leading-relaxed">
        Your Pro subscription is now active. You have unlocked unlimited
        documentation sources and priority features.
      </p>

      {checkoutId && (
        <div className="mb-6 p-4 bg-white/5 rounded-lg border border-white/10 break-all">
          <p className="text-xs text-neutral-500 font-mono mb-1 uppercase tracking-wider">
            Checkout ID
          </p>
          <p className="text-sm text-neutral-300 font-mono">{checkoutId}</p>
        </div>
      )}

      <Link
        href="/chat"
        className="block w-full py-4 bg-white text-black rounded-xl font-semibold hover:shadow-[0_0_20px_rgba(255,255,255,0.3)] transition-all transform hover:-translate-y-0.5"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <div className="relative min-h-screen dark bg-black noise-overlay font-sans text-neutral-200">
      {/* Background */}
      <AuraBackground />
      <div className="fixed inset-0 pointer-events-none z-0 technical-grid opacity-30"></div>

      <Navbar />

      <main className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <Suspense fallback={<div>Loading...</div>}>
          <SuccessContent />
        </Suspense>
      </main>

      <Footer />
    </div>
  );
}
