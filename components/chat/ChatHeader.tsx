"use client";

import { ChevronDown, History, FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const models = [
  { id: "chatdoc-1.0", name: "ChatDoc 1.0" },
  { id: "chatdoc-1.5", name: "ChatDoc 1.5" },
  { id: "chatdoc-2.0", name: "ChatDoc 2.0" },
];

interface Workspace {
  id: string;
  name: string;
  DocSource: {
    productName: string;
    rootUrl: string;
    status: string;
    chunkCount: number;
  };
}

interface ChatHeaderProps {
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  workspace?: Workspace | null;
}

export function ChatHeader({
  selectedModel = "chatdoc-1.0",
  onModelChange,
  workspace,
}: ChatHeaderProps) {
  const currentModel = models.find((m) => m.id === selectedModel) || models[0];

  return (
    <header className="h-14 min-h-14 max-h-14 px-4 border-b border-white/[0.08] flex-shrink-0 z-10 bg-black flex items-center justify-between overflow-hidden">
      <div className="flex items-center gap-4 min-w-0">
        {/* Model Selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="gap-2 text-white hover:bg-white/[0.04] font-medium whitespace-nowrap"
            >
              {currentModel.name}
              <ChevronDown className="w-4 h-4 text-neutral-500 flex-shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="bg-black border-white/[0.08] min-w-[180px]"
          >
            {models.map((model) => (
              <DropdownMenuItem
                key={model.id}
                onClick={() => onModelChange?.(model.id)}
                className="text-white hover:bg-white/[0.06] focus:bg-white/[0.06] cursor-pointer"
              >
                {model.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-4 min-w-0 flex-shrink-0">
        {/* Workspace Badge */}
        {workspace && (
          <div className="flex items-center gap-2 px-3 h-full">
            <div className="flex flex-col justify-center min-w-0">
              <span className="text-sm font-medium text-white truncate">
                {workspace.DocSource.productName}
              </span>
              <span className="text-[10px] text-emerald-400/80 truncate">
                {workspace.DocSource.chunkCount.toLocaleString()} chunks
              </span>
            </div>
            <a
              href={workspace.DocSource.rootUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md hover:bg-white/5 text-neutral-500 hover:text-emerald-400 transition-colors flex-shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        {/* <Button
          variant="ghost"
          size="icon"
          className="text-neutral-400 hover:text-white hover:bg-white/[0.04]"
        >
          <History className="w-5 h-5" />
        </Button> */}
      </div>
    </header>
  );
}
