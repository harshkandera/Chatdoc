"use client";

import { GeminiIcon } from "@/public/assets.js";
import { PineconeIcon } from "@/public/assets.js";
import { LangChainIcon } from "@/public/assets.js";
import { VercelIcon } from "@/public/assets.js";
import { NextjsIcon } from "@/public/assets.js";
import { TypeScriptIcon } from "@/public/assets.js";
import { LangGraphIcon } from "@/public/assets.js";

export function LogoMarquee() {
  const logos = [
    { name: "Gemini", Icon: GeminiIcon },
    { name: "Pinecone", Icon: PineconeIcon },
    { name: "LangChain", Icon: LangChainIcon },
    { name: "Vercel", Icon: VercelIcon },
    { name: "Next.js", Icon: NextjsIcon },
    { name: "TypeScript", Icon: TypeScriptIcon },
    { name: "LangSmith", Icon: LangChainIcon },
    { name: "LangGraph", Icon: LangGraphIcon },
  ];

  return (
    <div className="border-b border-white/5 bg-black py-8">
      <div className="max-w-[1400px] mx-auto overflow-hidden marquee-wrapper">
        <div className="marquee-content flex items-center gap-8 opacity-40 grayscale hover:grayscale-0 hover:opacity-80 transition-all duration-700">
          {[...logos, ...logos, ...logos].map((logo, i) => (
            <div
              key={i}
              className="flex items-center gap-3 text-white/60 hover:text-white transition-colors px-4"
            >
              <logo.Icon size={22} />

              <span className="text-xs font-mono uppercase tracking-wider">
                {logo.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
