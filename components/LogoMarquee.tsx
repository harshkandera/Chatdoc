"use client";

export function LogoMarquee() {
  const logos = [
    { name: "Gemini", icon: "🤖" },
    { name: "Pinecone", icon: "🌲" },
    { name: "LangChain", icon: "🔗" },
    { name: "Vercel", icon: "▲" },
    { name: "Next.js", icon: "N" },
    { name: "TypeScript", icon: "TS" },
    { name: "LangSmith", icon: "LS" },
    { name: "LangGraph", icon: "LG" },
  ];

  return (
    <div className="border-b border-white/5 bg-black py-8">
      <div className="max-w-[1400px] mx-auto overflow-hidden marquee-wrapper">
        <div className="marquee-content opacity-40 grayscale hover:grayscale-0 hover:opacity-80 transition-all duration-700 items-center">
          {[...logos, ...logos, ...logos].map((logo, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-white/60 hover:text-white transition-colors px-4"
            >
              <span className="text-2xl">{logo.icon}</span>
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
