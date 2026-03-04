"use client";

import { useState } from "react";
import { ExternalLink, ChevronDown, ChevronUp, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

interface SourcesProps {
  sources: string[];
  className?: string;
}

function titleFromUrl(url: string): string {
  try {
    const { pathname, hostname } = new URL(url);
    if (!pathname || pathname === "/") return hostname;
    const segments = pathname.split("/").filter(Boolean);
    const last = decodeURIComponent(segments[segments.length - 1] ?? "");
    return (
      last
        .replace(/[-_]/g, " ")
        .replace(/\.html?$/i, "")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim() || hostname
    );
  } catch {
    return url;
  }
}

function faviconUrl(url: string): string {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return "";
  }
}

function SourceFavicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(url);

  if (failed || !src) {
    return (
      <div className="shrink-0 w-5 h-5 rounded-md bg-neutral-700 flex items-center justify-center">
        <Globe className="w-3 h-3 text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="shrink-0 w-5 h-5 rounded-md bg-neutral-800 flex items-center justify-center overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={14}
        height={14}
        className="w-3.5 h-3.5 object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export function Sources({ sources, className }: SourcesProps) {
  const [open, setOpen] = useState(false);
  const unique = Array.from(new Set(sources));
  const visible = open ? unique : unique.slice(0, 3);

  if (unique.length === 0) return null;

  return (
    <div className={cn("mt-3 w-full", className)}>
      {/* Full-width divider — negative margin to escape MessageContent padding */}
      {/* <div className="-mx-4 border-t border-neutral-800 mb-3" /> */}

      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">
          Sources ({unique.length})
        </span>
        {unique.length > 3 && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-0.5 text-[11px] text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            {open ? "Show less" : "Show all"}
            {open ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
        )}
      </div>

      {/* Source chips — compact */}
      <div className="flex flex-wrap gap-1.5">
        {visible.map((src, i) => (
          <a
            key={i}
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "group inline-flex items-center gap-1.5",
              "pl-1.5 pr-2.5 py-1",
              "rounded-lg",
              "bg-neutral-900 hover:bg-neutral-800",
              "border border-neutral-800 hover:border-neutral-700",
              "transition-all duration-150",
              "max-w-[180px]",
            )}
          >
            <SourceFavicon url={src} />
            <span className="text-[12px] font-medium text-neutral-300 group-hover:text-white truncate transition-colors leading-none">
              {titleFromUrl(src)}
            </span>
            <ExternalLink className="shrink-0 w-2.5 h-2.5 text-neutral-600 group-hover:text-neutral-400 transition-colors" />
          </a>
        ))}
      </div>
    </div>
  );
}
