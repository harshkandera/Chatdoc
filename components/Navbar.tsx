"use client";

import Link from "next/link";
import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";
import UserDropdown from "./UserProfileButton";
import Logo from "@/public/log.png";
import Image from "next/image";
import { useState } from "react";

export function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <>
      <div className="fixed z-50 flex w-full top-6 px-6 justify-center">
        <nav className="flex w-full max-w-[1400px] mx-auto items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Image src={Logo} alt="Logo" width={48} height={48} />
            <span className="text-sm font-semibold tracking-tight text-white uppercase">
              ChatDoc
            </span>
          </Link>

          {/* Desktop Menu */}
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
            <Link
              href="#pricing"
              className="px-5 py-2 rounded-full text-neutral-400 hover:text-white hover:bg-white/5 text-[11px] font-medium transition-all tracking-wide"
            >
              Pricing
            </Link>

            <SignedOut>
              <SignInButton mode="modal" forceRedirectUrl="/chat">
                <button className="px-5 py-2 rounded-full bg-white text-black text-[11px] font-semibold tracking-wide hover:shadow-[0_0_10px_rgba(255,255,255,0.3)] transition-all cursor-pointer">
                  Get Started
                </button>
              </SignInButton>
            </SignedOut>

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

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden flex items-center gap-2 text-[11px] font-medium text-white uppercase tracking-wider hover:opacity-70 transition-opacity z-50 bg-black/50 px-3 py-1.5 rounded-full backdrop-blur-md border border-white/10"
          >
            {isMobileMenuOpen ? "Close" : "Menu"}
            <span className="text-neutral-500">
              {isMobileMenuOpen ? "×" : "+"}
            </span>
          </button>
        </nav>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 animate-in fade-in slide-in-from-top-5 duration-200">
          <div className="flex flex-col items-center gap-6 w-full max-w-sm">
            <Link
              href="#features"
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-lg font-medium text-neutral-300 hover:text-white transition-colors"
            >
              Features
            </Link>
            <Link
              href="#how-it-works"
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-lg font-medium text-neutral-300 hover:text-white transition-colors"
            >
              How it Works
            </Link>
            <Link
              href="#tech"
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-lg font-medium text-neutral-300 hover:text-white transition-colors"
            >
              Tech Stack
            </Link>
            <Link
              href="#pricing"
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-lg font-medium text-neutral-300 hover:text-white transition-colors"
            >
              Pricing
            </Link>

            <div className="w-full h-px bg-white/10 my-2" />

            <SignedOut>
              <SignInButton mode="modal" forceRedirectUrl="/chat">
                <button className="w-full py-3 rounded-full bg-white text-black font-semibold tracking-wide hover:shadow-[0_0_15px_rgba(255,255,255,0.3)] transition-all">
                  Sign In / Get Started
                </button>
              </SignInButton>
            </SignedOut>

            <SignedIn>
              <Link
                href="/chat"
                className="w-full py-3 rounded-full bg-white text-black font-semibold text-center tracking-wide hover:shadow-[0_0_15px_rgba(255,255,255,0.3)] transition-all"
              >
                Start Chatting
              </Link>
              <div className="mt-4">
                <UserDropdown />
              </div>
            </SignedIn>
          </div>
        </div>
      )}
    </>
  );
}
