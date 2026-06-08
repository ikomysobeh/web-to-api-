import { useEffect } from "react";
import {
  BookOpen,
  MessageSquarePlus,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import type { ChatGroup } from "@/data/mockChats";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { SidebarItem } from "./SidebarItem";
import { SidebarFooter } from "./SidebarFooter";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MobileSidebarProps {
  groups: ChatGroup[];
  activeChatId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
}

// ---------------------------------------------------------------------------
// MobileSidebar — custom drawer (avoids shadcn Sheet rendering issues)
// ---------------------------------------------------------------------------

export function MobileSidebar({
  groups,
  activeChatId,
  open,
  onOpenChange,
  onSelectChat,
  onNewChat,
  onDeleteChat,
}: MobileSidebarProps) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onOpenChange]);

  // Prevent body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  function handleSelectChat(id: string) {
    onSelectChat(id);
    onOpenChange(false);
  }

  function handleNewChat() {
    onNewChat();
    onOpenChange(false);
  }

  return (
    <>
      {/* ── Backdrop ─────────────────────────────────────────────────────── */}
      <div
        aria-hidden="true"
        onClick={() => onOpenChange(false)}
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 md:hidden",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
      />

      {/* ── Drawer panel ─────────────────────────────────────────────────── */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={cn(
          // Position
          "fixed inset-y-0 left-0 z-50 md:hidden",
          // Size
          "flex w-72 flex-col",
          // Colours — match desktop sidebar
          "bg-zinc-950/98 text-zinc-100 backdrop-blur-sm",
          "border-r border-zinc-800/70",
          // Slide animation
          "transition-transform duration-200 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between px-3 pt-3 pb-2 border-b border-zinc-800/50 bg-zinc-950/90">
          {/* Logo + name */}
          <div className="flex items-center gap-2 select-none">
            <div className="flex size-7 items-center justify-center rounded-lg bg-violet-600">
              <Sparkles className="size-4 text-white" />
            </div>
            <span className="text-base font-semibold tracking-tight text-white">
              Lumina AI
            </span>
          </div>

          {/* Close button */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            aria-label="Close menu"
            className="text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* ── Navigation buttons ────────────────────────────────────────── */}
        <div className="px-2 pb-1 space-y-0.5">
          {/* New chat */}
          <Button
            variant="ghost"
            onClick={handleNewChat}
            className="w-full justify-start gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800/70 hover:text-white"
          >
            <MessageSquarePlus className="size-4 shrink-0" />
            New chat
          </Button>

          {/* Search */}
          <Button
            variant="ghost"
            className="w-full justify-start gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-300"
          >
            <Search className="size-4 shrink-0" />
            Search chats
          </Button>

          {/* Library */}
          <Button
            variant="ghost"
            className="w-full justify-start gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-300"
          >
            <BookOpen className="size-4 shrink-0" />
            Library
          </Button>
        </div>

        <Separator className="mx-2 w-auto bg-zinc-800" />

        {/* ── Chat history ──────────────────────────────────────────────── */}
        {groups.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-xs text-zinc-600">
            No conversations yet.
            <br />
            Start a new chat!
          </div>
        ) : (
          <ScrollArea className="flex-1 px-2 py-2">
            {groups.map((group) => (
              <div key={group.label} className="mb-3">
                <p className="mb-1 px-3 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                  {group.label}
                </p>
                {group.chats.map((chat) => (
                  <SidebarItem
                    key={chat.id}
                    id={chat.id}
                    title={chat.title}
                    active={chat.id === activeChatId}
                    onClick={() => handleSelectChat(chat.id)}
                    onDelete={() => onDeleteChat(chat.id)}
                  />
                ))}
              </div>
            ))}
          </ScrollArea>
        )}

        <Separator className="mx-2 w-auto bg-zinc-800" />

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <SidebarFooter collapsed={false} />
      </aside>
    </>
  );
}