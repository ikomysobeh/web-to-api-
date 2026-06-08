import { Sparkles, PanelLeft, SquarePen, Zap } from "lucide-react";

import type { ChatSession } from "@/types/chat";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TopBarProps {
  activeChat: ChatSession | null;
  onOpenMobileSidebar: () => void;
  onNewChat: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function TopBar({
  activeChat,
  onOpenMobileSidebar,
  onNewChat,
  sidebarCollapsed,
  onToggleSidebar,
}: TopBarProps) {
  return (
    <TooltipProvider>
      <header className="absolute inset-x-0 top-0 z-50 flex h-13 shrink-0 items-center gap-2 bg-transparent px-3">
        {/* Left side */}
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open menu"
                onClick={onOpenMobileSidebar}
                className="rounded-full text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 md:hidden"
              >
                <PanelLeft className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open menu</TooltipContent>
          </Tooltip>

          {sidebarCollapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Expand sidebar"
                  onClick={onToggleSidebar}
                  className="hidden rounded-full text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 md:inline-flex"
                >
                  <PanelLeft className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Expand sidebar</TooltipContent>
            </Tooltip>
          )}

          <div className="flex select-none items-center gap-1.5 md:hidden">
            <div className="flex size-6 items-center justify-center rounded-lg bg-violet-600">
              <Sparkles className="size-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-white">Lumina AI</span>
          </div>
        </div>

        {/* Center title */}
        <div className="min-w-0 flex-1 px-2">
          {activeChat ? (
            <p className="truncate text-sm font-medium text-zinc-300">
              {activeChat.title}
            </p>
          ) : null}
        </div>

        {/* Right side */}
        <div className="flex shrink-0 items-center justify-end gap-2">
          <Button
            size="sm"
            className="hidden items-center gap-2 rounded-full bg-zinc-800 px-4 text-xs font-medium text-white shadow-sm hover:bg-zinc-700 sm:inline-flex"
          >
            <Zap className="size-3.5" />
            Try Pro
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New chat"
                onClick={onNewChat}
                className="rounded-full text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
              >
                <SquarePen className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New chat</TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  );
}