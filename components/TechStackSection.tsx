"use client";

import {
  Database,
  Cpu,
  Layers,
  Server,
  GitBranch,
  BarChart3,
  Code2,
  Zap,
  Eye,
} from "lucide-react";

// Column 1 items (scrolls up)
const techItemsColumn1 = [
  { name: "Gemini", type: "AI Models", icon: Cpu, color: "#10b981" },
  { name: "Pinecone", type: "Vector DB", icon: Database, color: "#3ECF8E" },
  { name: "LangChain", type: "Orchestration", icon: Layers, color: "#61DAFB" },
  { name: "Next.js", type: "Framework", icon: Server, color: "#ffffff" },
];

// Column 2 items (scrolls down)
const techItemsColumn2 = [
  { name: "TypeScript", type: "Language", icon: Code2, color: "#3178C6" },
  { name: "Vercel", type: "Deployment", icon: Zap, color: "#ffffff" },
  {
    name: "LangGraph",
    type: "Agent Framework",
    icon: GitBranch,
    color: "#FF6B35",
  },
  {
    name: "LangSmith",
    type: "Observability",
    icon: BarChart3,
    color: "#A855F7",
  },
];

// Column 3 items (scrolls up)
const techItemsColumn3 = [
  { name: "OpenAI", type: "Intelligence", icon: Eye, color: "#ffffff" },
  { name: "Chroma", type: "Vector Store", icon: Database, color: "#FF6B6B" },
  { name: "Python", type: "Backend", icon: Code2, color: "#3776AB" },
  { name: "Inggest", type: "Ingestion", icon: Cpu, color: "#3776AB" },
];

export function TechStackSection() {
  return (
    <section
      id="tech"
      className="relative bg-black border-b border-white/5 overflow-hidden"
    >
      {/* CSS for wall animations - matching HTML template exactly */}
      <style jsx>{`
        .wall-container {
          perspective: 2000px;
          transform-style: preserve-3d;
        }
        .wall-grid {
          transform: rotateY(-18deg) rotateX(10deg) rotateZ(-2deg) scale(1.1);
          transform-style: preserve-3d;
        }
        .wall-column {
          will-change: transform;
        }
        .wall-column-up {
          animation: scrollUp 40s linear infinite;
        }
        .wall-column-down {
          animation: scrollDown 40s linear infinite;
        }
        @keyframes scrollUp {
          0% {
            transform: translateY(0);
          }
          100% {
            transform: translateY(-50%);
          }
        }
        @keyframes scrollDown {
          0% {
            transform: translateY(-50%);
          }
          100% {
            transform: translateY(0);
          }
        }
        .wall-card {
          background: rgba(23, 23, 23, 0.6);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow:
            0 4px 30px rgba(0, 0, 0, 0.3),
            inset 0 0 20px rgba(255, 255, 255, 0.02);
          transition:
            border-color 0.3s,
            background-color 0.3s,
            transform 0.3s;
        }
        .wall-card:hover {
          border-color: rgba(255, 255, 255, 0.2);
          background: rgba(30, 30, 30, 0.8);
          transform: translateZ(20px);
          box-shadow:
            0 20px 40px rgba(0, 0, 0, 0.5),
            inset 0 0 20px rgba(255, 255, 255, 0.05);
        }
      `}</style>

      {/* Background Glow */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-emerald-900/20 blur-[120px] rounded-full pointer-events-none z-0"></div>

      <div className="max-w-[1400px] mx-auto relative z-10 flex flex-col md:flex-row min-h-[900px]">
        {/* Left Content */}
        <div className="w-full md:w-[40%] px-6 py-20 md:py-32 flex flex-col justify-center relative z-20 bg-gradient-to-r from-black via-black to-transparent">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 border border-white/10 rounded-full bg-white/5 self-start">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-[10px] font-mono text-emerald-300 uppercase tracking-widest">
              Infrastructure
            </span>
          </div>

          <h2 className="text-5xl md:text-7xl font-medium tracking-tighter text-white mb-8 leading-[0.9]">
            The
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-br from-white via-neutral-200 to-neutral-500">
              Stack.
            </span>
          </h2>

          <div className="space-y-8 max-w-sm">
            <p className="text-neutral-400 text-lg font-light leading-relaxed">
              We leverage modern RAG infrastructure to deliver accurate, sourced
              answers from your documentation. Every component is optimized for
              precision and speed.
            </p>

            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4 group cursor-pointer">
                <div className="w-10 h-10 rounded border border-white/10 bg-white/5 flex items-center justify-center group-hover:bg-white/10 group-hover:border-white/20 transition-all">
                  <Database className="w-5 h-5 text-neutral-400 group-hover:text-white transition-colors" />
                </div>
                <div>
                  <div className="text-white text-sm font-medium">
                    Vector Database
                  </div>
                  <div className="text-[10px] text-neutral-500 font-mono uppercase">
                    Pinecone / Chroma
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 group cursor-pointer">
                <div className="w-10 h-10 rounded border border-white/10 bg-white/5 flex items-center justify-center group-hover:bg-white/10 group-hover:border-white/20 transition-all">
                  <Cpu className="w-5 h-5 text-neutral-400 group-hover:text-white transition-colors" />
                </div>
                <div>
                  <div className="text-white text-sm font-medium">
                    AI Models
                  </div>
                  <div className="text-[10px] text-neutral-500 font-mono uppercase">
                    GPT-4 / Gemini
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 group cursor-pointer">
                <div className="w-10 h-10 rounded border border-white/10 bg-white/5 flex items-center justify-center group-hover:bg-white/10 group-hover:border-white/20 transition-all">
                  <Layers className="w-5 h-5 text-neutral-400 group-hover:text-white transition-colors" />
                </div>
                <div>
                  <div className="text-white text-sm font-medium">
                    Agent Framework
                  </div>
                  <div className="text-[10px] text-neutral-500 font-mono uppercase">
                    LangGraph / LangSmith
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-8">
              <button className="shiny-cta">
                <span>View Architecture</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right: The Infinite 3D Wall - Matching HTML template exactly with 3 columns */}
        <div className="absolute right-[-10%] md:right-[-5%] top-[-10%] bottom-[-10%] w-[120%] md:w-[70%] wall-container overflow-hidden pointer-events-none md:pointer-events-auto">
          <div className="wall-grid h-full w-full flex gap-6 px-10">
            {/* Column 1 (Scroll Up) */}
            <div className="wall-column wall-column-up flex flex-col gap-6 w-full">
              {/* Original items */}
              {techItemsColumn1.map((tech) => {
                const Icon = tech.icon;
                return (
                  <div
                    key={tech.name}
                    className="wall-card rounded-xl p-6 aspect-4/3 flex flex-col justify-between"
                  >
                    <div className="flex justify-between items-start">
                      <Icon className="w-8 h-8" style={{ color: tech.color }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
                    </div>
                    <div>
                      <div className="text-sm font-mono text-white/80">
                        {tech.name}
                      </div>
                      <div className="text-[9px] font-mono text-neutral-500">
                        {tech.type}
                      </div>
                    </div>
                  </div>
                );
              })}
              {/* Duplicated items for infinite loop */}
              {techItemsColumn1.map((tech) => {
                const Icon = tech.icon;
                return (
                  <div
                    key={`${tech.name}-clone`}
                    className="wall-card rounded-xl p-6 aspect-4/3 flex flex-col justify-between"
                  >
                    <div className="flex justify-between items-start">
                      <Icon className="w-8 h-8" style={{ color: tech.color }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
                    </div>
                    <div>
                      <div className="text-sm font-mono text-white/80">
                        {tech.name}
                      </div>
                      <div className="text-[9px] font-mono text-neutral-500">
                        {tech.type}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Column 2 (Scroll Down) */}
            <div className="wall-column wall-column-down flex flex-col gap-6 w-full pt-12">
              {/* Original items */}
              {techItemsColumn2.map((tech) => {
                const Icon = tech.icon;
                return (
                  <div
                    key={tech.name}
                    className="wall-card rounded-xl p-6 aspect-4/3 flex flex-col justify-between"
                  >
                    <div className="flex justify-between items-start">
                      <Icon className="w-8 h-8" style={{ color: tech.color }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
                    </div>
                    <div>
                      <div className="text-sm font-mono text-white/80">
                        {tech.name}
                      </div>
                      <div className="text-[9px] font-mono text-neutral-500">
                        {tech.type}
                      </div>
                    </div>
                  </div>
                );
              })}
              {/* Duplicated items for infinite loop */}
              {techItemsColumn2.map((tech) => {
                const Icon = tech.icon;
                return (
                  <div
                    key={`${tech.name}-clone`}
                    className="wall-card rounded-xl p-6 aspect-4/3 flex flex-col justify-between"
                  >
                    <div className="flex justify-between items-start">
                      <Icon className="w-8 h-8" style={{ color: tech.color }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
                    </div>
                    <div>
                      <div className="text-sm font-mono text-white/80">
                        {tech.name}
                      </div>
                      <div className="text-[9px] font-mono text-neutral-500">
                        {tech.type}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Column 3 (Scroll Up) - Hidden on smaller screens like HTML template */}
            <div className="wall-column wall-column-up flex flex-col gap-6 w-full pt-24 hidden lg:flex">
              {/* Original items */}
              {techItemsColumn3.map((tech) => {
                const Icon = tech.icon;
                return (
                  <div
                    key={tech.name}
                    className="wall-card rounded-xl p-6 aspect-4/3 flex flex-col justify-between"
                  >
                    <div className="flex justify-between items-start">
                      <Icon className="w-8 h-8" style={{ color: tech.color }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
                    </div>
                    <div>
                      <div className="text-sm font-mono text-white/80">
                        {tech.name}
                      </div>
                      <div className="text-[9px] font-mono text-neutral-500">
                        {tech.type}
                      </div>
                    </div>
                  </div>
                );
              })}
              {/* Duplicated items for infinite loop */}
              {techItemsColumn3.map((tech) => {
                const Icon = tech.icon;
                return (
                  <div
                    key={`${tech.name}-clone`}
                    className="wall-card rounded-xl p-6 aspect-4/3 flex flex-col justify-between"
                  >
                    <div className="flex justify-between items-start">
                      <Icon className="w-8 h-8" style={{ color: tech.color }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
                    </div>
                    <div>
                      <div className="text-sm font-mono text-white/80">
                        {tech.name}
                      </div>
                      <div className="text-[9px] font-mono text-neutral-500">
                        {tech.type}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Heavy Masking on the Wall to Blend it - matching HTML template */}
          <div className="absolute inset-0 bg-gradient-to-r from-black via-transparent to-transparent z-10 pointer-events-none"></div>
          <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black z-10 pointer-events-none opacity-50"></div>
        </div>
      </div>
    </section>
  );
}
