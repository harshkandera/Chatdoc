"use client";

import { useState } from "react";
import { ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SourcesProps {
  sources: string[];
  className?: string;
}

function getDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

function getFavicon(url: string): string {
  try {
    const parsed = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`;
  } catch {
    return "";
  }
}

function getDisplayTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      // Get last path segment and clean it up
      const lastPart = pathParts[pathParts.length - 1];
      return lastPart
        .replace(/-/g, " ")
        .replace(/_/g, " ")
        .replace(/\.(html|htm|php|aspx)$/i, "")
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    }
    return parsed.hostname;
  } catch {
    return url;
  }
}

export function Sources({ sources, className }: SourcesProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!sources || sources.length === 0) return null;

  // Remove duplicates
  const uniqueSources = [...new Set(sources)];
  const displayedSources = isExpanded
    ? uniqueSources
    : uniqueSources.slice(0, 3);
  const hasMore = uniqueSources.length > 3;

  return (
    <div className={cn("mt-4 pt-4 border-t border-white/[0.08]", className)}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-neutral-400 uppercase tracking-wide">
          Sources ({uniqueSources.length})
        </span>
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-neutral-400 hover:text-white h-6 px-2"
          >
            {isExpanded ? (
              <>
                Show less <ChevronUp className="w-3 h-3 ml-1" />
              </>
            ) : (
              <>
                Show all <ChevronDown className="w-3 h-3 ml-1" />
              </>
            )}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {displayedSources.map((source, index) => (
          <a
            key={index}
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 px-3 py-2 bg-neutral-800/50 hover:bg-neutral-700/50 border border-white/[0.06] hover:border-white/[0.12] rounded-lg transition-all"
          >
            <img
              src={getFavicon(source)}
              alt=""
              className="w-4 h-4 rounded-sm"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <span className="text-sm text-neutral-300 group-hover:text-white max-w-[200px] truncate">
              {getDisplayTitle(source)}
            </span>
            <ExternalLink className="w-3 h-3 text-neutral-500 group-hover:text-neutral-300" />
          </a>
        ))}
      </div>

      {/* Compact domain list for many sources */}
      {isExpanded && uniqueSources.length > 6 && (
        <div className="mt-3 pt-3 border-t border-white/[0.04]">
          <div className="text-xs text-neutral-500">
            Domains: {[...new Set(uniqueSources.map(getDomain))].join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}
