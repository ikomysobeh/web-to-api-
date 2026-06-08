import {
  BookOpen,
  ChevronLeft,
  MessageSquarePlus,
  Search,
  Sparkles,
} from "lucide-react";

import type { ChatGroup } from "@/data/mockChats";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { SidebarFooter } from "./SidebarFooter";
import { SidebarItem } from "./SidebarItem";

interface SidebarProps {
  groups: ChatGroup[];
  activeChatId: string | null;
  collapsed: boolean;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onToggleCollapse: () => void;
  onDeleteChat: (id: string) => void;
}

function NavIconButton({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          aria-label={label}
          className={cn(
            "size-9 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
            active && "bg-zinc-800 text-zinc-100",
          )}
        >
          <Icon className="size-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({
  groups,
  activeChatId,
  collapsed,
  onSelectChat,
  onNewChat,
  onToggleCollapse,
  onDeleteChat,
}: SidebarProps) {
  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "relative flex h-full flex-col overflow-hidden border-r border-zinc-800/70 bg-zinc-950/95 text-zinc-100 backdrop-blur-sm transition-[width] duration-200 ease-in-out",
        collapsed ? "w-14" : "w-64",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center px-2 pb-2 pt-3 bg-zinc-950/90 border-b border-zinc-800/50",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {!collapsed ? (
          <>
            <div className="flex select-none items-center gap-2 pl-1">
              <div className="flex size-7 items-center justify-center rounded-lg bg-violet-600">
                <Sparkles className="size-4 text-white" />
              </div>
              <span className="text-base font-semibold tracking-tight text-white">
                Lumina AI
              </span>
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onToggleCollapse}
                  aria-label="Collapse sidebar"
                  className="shrink-0 text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100"
                >
                  <ChevronLeft className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Collapse sidebar</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <div className="flex size-7 items-center justify-center rounded-lg bg-violet-600">
            <Sparkles className="size-4 text-white" />
          </div>
        )}
      </div>

      {collapsed && (
        <>
          <div className="flex flex-col items-center gap-1 px-2 py-2">
            <NavIconButton
              icon={MessageSquarePlus}
              label="New chat"
              onClick={onNewChat}
            />
            <NavIconButton icon={Search} label="Search chats" />
            <NavIconButton icon={BookOpen} label="Library" />
          </div>
          <div className="flex-1" />
        </>
      )}

      {!collapsed && (
        <>
          <div className="px-2 pb-1">
            <Button
              variant="ghost"
              onClick={onNewChat}
              className="w-full justify-start gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800/70 hover:text-white"
            >
              <MessageSquarePlus className="size-4 shrink-0" />
              New chat
            </Button>
          </div>

          <div className="px-2 pb-1">
            <Button
              variant="ghost"
              className="w-full justify-start gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
            >
              <Search className="size-4 shrink-0" />
              Search chats
            </Button>
          </div>

          <div className="px-2 pb-2">
            <Button
              variant="ghost"
              className="w-full justify-start gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
            >
              <BookOpen className="size-4 shrink-0" />
              Library
            </Button>
          </div>

          <Separator className="mx-2 w-auto bg-zinc-800/60" />

          {groups.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-zinc-600">
              No conversations yet.
              <br />
              Start a new chat!
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="px-2 py-2 pr-3">
                {groups.map((group) => (
                  <div key={group.label} className="mb-3">
                    <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                      {group.label}
                    </p>

                    {group.chats.map((chat) => (
                      <SidebarItem
                        key={chat.id}
                        id={chat.id}
                        title={chat.title}
                        active={chat.id === activeChatId}
                        onClick={() => onSelectChat(chat.id)}
                        onDelete={() => onDeleteChat(chat.id)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </>
      )}

      <Separator className="mx-2 w-auto bg-zinc-800" />
      <SidebarFooter collapsed={collapsed} />
    </aside>
  );
}