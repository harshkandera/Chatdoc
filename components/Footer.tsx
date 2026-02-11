"use client";

import Link from "next/link";
import { FileText } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-black pt-32 pb-12 border-t border-white/10">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between items-end mb-24">
          <div className="text-[12vw] md:text-[10vw] leading-[0.8] font-bold tracking-tighter text-white opacity-90 select-none hover:text-transparent hover:bg-clip-text hover:bg-gradient-to-t hover:from-neutral-800 hover:to-white transition-all duration-700 cursor-default">
            CHATDOC
          </div>
          <div className="flex flex-col gap-4 text-right mb-4 mt-8 md:mt-0">
            <Link
              href="/chat"
              className="text-lg text-neutral-400 hover:text-white transition-colors"
            >
              Start Chatting →
            </Link>
            <div className="text-sm text-neutral-600">
              Powered by AI • Built for Developers
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 border-t border-white/10 pt-10">
          <div>
            <h4 className="text-[10px] font-mono uppercase text-neutral-500 mb-4">
              Product
            </h4>
            <ul className="space-y-2 text-sm text-neutral-400">
              <li>
                <Link
                  href="#features"
                  className="hover:text-white transition-colors"
                >
                  Features
                </Link>
              </li>
              <li>
                <Link
                  href="#how-it-works"
                  className="hover:text-white transition-colors"
                >
                  How it Works
                </Link>
              </li>
              <li>
                <Link href="#" className="hover:text-white transition-colors">
                  Pricing
                </Link>
              </li>
            </ul>
          </div>
          {/* 
          <div>
            <h4 className="text-[10px] font-mono uppercase text-neutral-500 mb-4">
              Resources
            </h4>
            <ul className="space-y-2 text-sm text-neutral-400">
              <li>
                <Link href="#" className="hover:text-white transition-colors">
                  Documentation
                </Link>
              </li>
              <li>
                <Link href="#" className="hover:text-white transition-colors">
                  API Reference
                </Link>
              </li>
              <li>
                <Link href="#" className="hover:text-white transition-colors">
                  Changelog
                </Link>
              </li>
            </ul>
          </div> */}

          <div>
            <h4 className="text-[10px] font-mono uppercase text-neutral-500 mb-4">
              Connect
            </h4>
            <ul className="space-y-2 text-sm text-neutral-400">
              <li>
                <Link
                  href="https://x.com/Harsh30721625"
                  className="hover:text-white transition-colors"
                >
                  Twitter / X
                </Link>
              </li>
              <li>
                <Link
                  href="https://github.com/harshkandera/"
                  className="hover:text-white transition-colors"
                >
                  GitHub
                </Link>
              </li>
              <li>
                <Link
                  href="https://www.linkedin.com/in/harsh-kandera-b22805238/"
                  className="hover:text-white transition-colors"
                >
                  LinkedIn
                </Link>
              </li>
            </ul>
          </div>

          <div className="md:text-right">
            <p className="text-[10px] font-mono uppercase text-neutral-600">
              System Status:{" "}
              <span className="text-emerald-500">Operational</span>
            </p>
            <p className="text-[10px] font-mono uppercase text-neutral-600 mt-1">
              © 2026 ChatDoc. All rights reserved.
            </p>
            <p className="text-[10px] font-mono uppercase text-neutral-600 mt-1">
              Developed by Harsh Kandera
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
