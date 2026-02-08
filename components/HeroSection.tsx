"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function HeroSection() {
  return (
    <section className="max-w-[1400px] mx-auto px-6 pb-40 pt-32 border-b border-white/5">
      <div className="max-w-5xl">
        {/* Status Badge */}
        <div className="inline-flex items-center gap-3 px-3 py-1.5 mb-10 border border-white/10 rounded-full bg-white/5 backdrop-blur-sm animate-in-view">
          <div className="flex items-center gap-2 px-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest">
              AI-Powered
            </span>
          </div>
          <div className="h-3 w-px bg-white/10"></div>
          <span className="text-[10px] text-neutral-400 font-mono">v1.0.0</span>
        </div>

        {/* Main Heading */}
        <h1 className="animate-in-view animate-delay-100 text-6xl md:text-8xl lg:text-[7rem] font-medium tracking-tighter text-white leading-[0.9] mb-12">
          Chat with your
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-b from-white via-neutral-200 to-neutral-600">
            Docs, not the web.
          </span>
        </h1>

        {/* Subtitle and CTA */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-12 animate-in-view animate-delay-200">
          <p className="text-lg text-neutral-400 max-w-xl leading-relaxed font-light">
            An AI-powered documentation workspace that lets developers chat
            directly with verified technical documentation. Get deterministic,
            accurate answers sourced exclusively from your indexed docs.
          </p>

          <div className="flex items-center gap-6">
            <Link href="/chat" className="group relative px-8 py-4 bg-white text-black text-xs font-bold tracking-widest uppercase overflow-hidden hover:bg-neutral-200 transition-all duration-300">
              <span className="relative z-10 flex items-center gap-2">
                Start Chatting
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </Link>
            <div className="h-px w-12 bg-white/20"></div>
            <span className="text-[10px] font-mono text-neutral-500">
              SCROLL TO EXPLORE
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
