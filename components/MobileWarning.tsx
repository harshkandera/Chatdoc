"use client";

// import { useEffect, useState } from "react";

import { Laptop } from "lucide-react";

export function MobileWarning() {

  // We use CSS to show/hide this, but we can also use state if we want to allow dismissal (optional)
  // For now, let's make it a persistent overlay on small screens using Tailwind.
  
  return (
    <div className="fixed inset-0 z-[100] md:hidden bg-black flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 bg-neutral-900 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-white/10">
        <Laptop className="w-8 h-8 text-neutral-400" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-3">
        Desktop Optimized
      </h2>
      <p className="text-neutral-400 max-w-xs mx-auto">
        ChatDoc is designed for a large screen experience. Please switch to a desktop or tablet for the best performance.
      </p>
    </div>
  );
}
