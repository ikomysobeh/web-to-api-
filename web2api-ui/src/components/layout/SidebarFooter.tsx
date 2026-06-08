import { Settings } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SidebarFooterProps {
  collapsed: boolean;
}

export function SidebarFooter({ collapsed }: SidebarFooterProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 px-2 py-3 transition-all",
        collapsed ? "justify-center" : "justify-between",
      )}
    >
      {/* Avatar + user info */}
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar size="sm" className="shrink-0 ring-1 ring-zinc-700">
          <AvatarFallback className="bg-violet-600 text-xs font-semibold text-white">
            NS
          </AvatarFallback>
        </Avatar>

        {/* Name — hidden when collapsed */}
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-100">
              Naya Smith
            </p>
            <p className="truncate text-xs text-zinc-500">Personal</p>
          </div>
        )}
      </div>

      {/* Settings button — hidden when collapsed (shown in icon row) */}
      {!collapsed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Settings"
              className="shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Settings className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      )}

      {/* Collapsed: settings icon below avatar */}
      {collapsed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Settings"
              className="absolute bottom-14 left-1/2 -translate-x-1/2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Settings className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
