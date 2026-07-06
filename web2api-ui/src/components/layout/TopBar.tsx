import { SquarePen } from "lucide-react";

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
  onNewChat: () => void;
}

export function TopBar({
  activeChat,
  onNewChat,
}: TopBarProps) {
  return (
    <TooltipProvider>
      <header className="absolute inset-x-0 top-0 z-50 flex h-13 shrink-0 items-center gap-2 bg-transparent px-3">
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