"use client";

import { ChevronDown, ExternalLink, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  MODEL_OPTIONS,
  DEFAULT_MODEL_ID,
  getModelOption,
  getModelCategories,
} from "@/lib/ai/model-options";

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
  onModelChange?: (modelId: string) => void;
  workspace?: Workspace | null;
}

export function ChatHeader({
  selectedModel = DEFAULT_MODEL_ID,
  onModelChange,
  workspace,
}: ChatHeaderProps) {
  const currentModel = getModelOption(selectedModel);
  const categories = getModelCategories();

  return (
    <header className="h-14 min-h-14 max-h-14 px-4 border-b border-white/[0.08] flex-shrink-0 z-10 bg-black flex items-center justify-between overflow-hidden">
      <div className="flex items-center gap-4 min-w-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="gap-2 text-white hover:bg-white/[0.04] font-medium whitespace-nowrap"
            >
              <span className="text-sm">{currentModel.name}</span>
              <span className="text-[10px] text-neutral-500 font-normal">
                {currentModel.category}
              </span>
              <ChevronDown className="w-4 h-4 text-neutral-500 flex-shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="bg-black border-white/[0.08] min-w-[240px]"
          >
            {categories.map((category, catIndex) => (
              <div key={category}>
                {catIndex > 0 && <DropdownMenuSeparator className="bg-white/[0.08]" />}
                <div className="px-2 py-1.5 text-[10px] font-semibold text-neutral-500 tracking-wider uppercase">
                  {category}
                </div>
                {MODEL_OPTIONS.filter((m) => m.category === category).map(
                  (model) => (
                    <DropdownMenuItem
                      key={model.id}
                      onClick={() => onModelChange?.(model.id)}
                      className="text-white hover:bg-white/[0.06] focus:bg-white/[0.06] cursor-pointer flex items-center justify-between gap-3"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {model.name}
                        </span>
                        <span className="text-[11px] text-neutral-500">
                          {model.description}
                        </span>
                      </div>
                      {model.id === selectedModel && (
                        <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ),
                )}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-4 min-w-0 flex-shrink-0">
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
      </div>
    </header>
  );
}
