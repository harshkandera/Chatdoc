"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    UnicornStudio?: {
      isInitialized: boolean;
      init: () => void;
    };
  }
}

export function AuraBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load Unicorn Studio for animated aura
    if (typeof window !== "undefined" && !window.UnicornStudio) {
      window.UnicornStudio = { isInitialized: false, init: () => {} };
      const script = document.createElement("script");
      script.src =
        "https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v1.4.29/dist/unicornStudio.umd.js";
      script.onload = () => {
        if (window.UnicornStudio && !window.UnicornStudio.isInitialized) {
          window.UnicornStudio.init();
          window.UnicornStudio.isInitialized = true;
        }
      };
      document.head.appendChild(script);
    }
  }, []);

  return (
    <>
      {/* Hero Video Background */}
      <div className="fixed inset-0 -z-30 w-full h-full overflow-hidden pointer-events-none">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover opacity-20 mix-blend-screen"
          style={{ filter: "hue-rotate(150deg) contrast(1.2)" }}
        >
          <source
            src="https://cdn.coverr.co/videos/coverr-digital-lines-moving-background-4770/1080p.mp4"
            type="video/mp4"
          />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-black via-black/80 to-black"></div>
      </div>

      {/* Animated Aura Background */}
      <div
        className="absolute top-0 w-full mix-blend-screen -z-20 h-[1200px] pointer-events-none"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent, black 0%, black 80%, transparent)",
        }}
      >
        <div className="absolute top-0 w-full -z-10 h-full">
          <div
            data-us-project="ILgOO23w4wEyPQOKyLO4"
            className="absolute w-full h-full left-0 top-0 -z-10"
            ref={containerRef}
          ></div>
        </div>
      </div>

      {/* Fallback CSS Aura Animation (visible if UnicornStudio doesn't load) */}
      <div className="fixed inset-0 -z-25 pointer-events-none overflow-hidden">
        {/* Primary purple orb */}
        <div
          className="absolute w-[800px] h-[800px] rounded-full blur-[150px] opacity-40 animate-aura-1"
          style={{
            background:
              "radial-gradient(circle, rgba(139,92,246,0.6) 0%, rgba(88,28,135,0.3) 50%, transparent 70%)",
            top: "10%",
            left: "20%",
          }}
        ></div>

        {/* Secondary blue orb */}
        <div
          className="absolute w-[600px] h-[600px] rounded-full blur-[120px] opacity-30 animate-aura-2"
          style={{
            background:
              "radial-gradient(circle, rgba(59,130,246,0.5) 0%, rgba(37,99,235,0.2) 50%, transparent 70%)",
            top: "30%",
            right: "10%",
          }}
        ></div>

        {/* Tertiary magenta orb */}
        <div
          className="absolute w-[500px] h-[500px] rounded-full blur-[100px] opacity-35 animate-aura-3"
          style={{
            background:
              "radial-gradient(circle, rgba(236,72,153,0.5) 0%, rgba(168,85,247,0.3) 50%, transparent 70%)",
            bottom: "20%",
            left: "40%",
          }}
        ></div>

        {/* Light beam effect */}
        <div
          className="absolute w-[200px] h-[1000px] blur-[80px] opacity-20 animate-beam"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, rgba(139,92,246,0.5) 30%, rgba(59,130,246,0.4) 70%, transparent 100%)",
            top: "-20%",
            left: "60%",
            transform: "rotate(-15deg)",
          }}
        ></div>
      </div>
    </>
  );
}
