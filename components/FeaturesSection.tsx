"use client";

import {
  Database,
  Search,
  CheckCircle,
  FileText,
  Zap,
  Shield,
} from "lucide-react";

const features = [
  {
    icon: Database,
    title: "Smart Indexing",
    color: "emerald",
    items: [
      { name: "URL Validation", num: "01" },
      { name: "Doc Crawling", num: "02" },
      { name: "Chunking & Embedding", num: "03" },
    ],
  },
  {
    icon: Search,
    title: "Vector Search",
    color: "purple",
    items: [
      { name: "Semantic Retrieval", num: "04" },
      { name: "Context Ranking", num: "05" },
      { name: "Rich Metadata", num: "06" },
    ],
  },
  {
    icon: CheckCircle,
    title: "Accurate Answers",
    color: "blue",
    items: [
      { name: "Confidence Scoring", num: "07" },
      { name: "Source Citations", num: "08" },
      { name: "Freshness Checks", num: "09" },
    ],
  },
];

const colorMap: Record<string, string> = {
  emerald: "via-emerald-500/50",
  purple: "via-purple-500/50",
  blue: "via-blue-500/50",
};

const colorHoverMap: Record<string, string> = {
  emerald: "group-hover:text-emerald-400",
  purple: "group-hover:text-purple-400",
  blue: "group-hover:text-blue-400",
};

export function FeaturesSection() {
  return (
    <section
      id="features"
      className="border-b border-white/5 bg-black py-32 relative"
    >
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex items-end justify-between mb-24">
          <div>
            <div className="text-[10px] font-mono text-neutral-500 uppercase mb-4">
              01 — Capabilities
            </div>
            <h2 className="text-4xl md:text-5xl font-medium tracking-tight text-white max-w-2xl leading-[1.05]">
              Intelligent documentation search for
              <br />
              <span className="text-neutral-600">mission critical</span>{" "}
              answers.
            </h2>
          </div>
          <div className="hidden md:block text-right">
            <div className="text-[10px] font-mono text-neutral-500 uppercase mb-1">
              Architecture
            </div>
            <div className="text-white font-mono text-sm">RAG v2.0</div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/10 border border-white/10 overflow-hidden spotlight-grid">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="group bg-black p-10 hover:bg-neutral-900/40 transition-colors relative spotlight-card"
              >
                <div
                  className={`absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent ${
                    colorMap[feature.color]
                  } to-transparent opacity-0 group-hover:opacity-100 transition-opacity`}
                ></div>
                <div
                  className={`mb-8 text-neutral-700 ${
                    colorHoverMap[feature.color]
                  } transition-colors`}
                >
                  <Icon className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-medium text-white mb-6">
                  {feature.title}
                </h3>
                <ul className="space-y-4">
                  {feature.items.map((item) => (
                    <li
                      key={item.num}
                      className="flex justify-between text-sm text-neutral-500 group-hover:text-white transition-colors border-b border-white/5 pb-2"
                    >
                      <span>{item.name}</span>
                      <span className="font-mono text-[10px]">{item.num}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
