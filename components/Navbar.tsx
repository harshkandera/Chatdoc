"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import UserDropdown from "./UserProfileButton";

export function Navbar() {
  return (
    <div className="fixed z-50 flex w-full top-6 px-6 justify-center">
      <nav className="flex w-full max-w-[1400px] mx-auto items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
            <FileText className="w-4 h-4 text-black" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-white uppercase">
            ChatDoc
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-1 backdrop-blur-xl bg-white/[0.03] border border-white/[0.08] rounded-full p-1.5 pr-2 shadow-[0_0_20px_rgba(0,0,0,0.5)]">
          <Link
            href="#features"
            className="px-5 py-2 rounded-full text-neutral-400 hover:text-white hover:bg-white/5 text-[11px] font-medium transition-all tracking-wide"
          >
            Features
          </Link>
          <Link
            href="#how-it-works"
            className="px-5 py-2 rounded-full text-neutral-400 hover:text-white hover:bg-white/5 text-[11px] font-medium transition-all tracking-wide"
          >
            How it Works
          </Link>
          <Link
            href="#tech"
            className="px-5 py-2 rounded-full text-neutral-400 hover:text-white hover:bg-white/5 text-[11px] font-medium transition-all tracking-wide"
          >
            Tech Stack
          </Link>

          {/* Show Sign In button when signed out, redirects to dashboard after sign in */}
          <SignedOut>
            <SignInButton mode="modal" forceRedirectUrl="/chat">
              <button className="px-5 py-2 rounded-full bg-white text-black text-[11px] font-semibold tracking-wide hover:shadow-[0_0_10px_rgba(255,255,255,0.3)] transition-all cursor-pointer">
                Get Started
              </button>
            </SignInButton>
          </SignedOut>

          {/* Show Dashboard link + UserDropdown when signed in */}
          <SignedIn>
            <Link
              href="/chat"
              className="px-5 py-2 rounded-full bg-white text-black text-[11px] font-semibold tracking-wide hover:shadow-[0_0_10px_rgba(255,255,255,0.3)] transition-all"
            >
              Start Chatting
            </Link>

            <div className="ml-2">
              <UserDropdown />
            </div>
          </SignedIn>
        </div>

        <button className="md:hidden flex items-center gap-2 text-[11px] font-medium text-white uppercase tracking-wider hover:opacity-70 transition-opacity">
          Menu
          <span className="text-neutral-500">+</span>
        </button>
      </nav>
    </div>
  );
}
