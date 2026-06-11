import { useEffect, useRef, useState } from "react";
import {
  MessageSquarePlus,
  Search,
  Shield,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { ChatGroup } from "@/data/mockChats";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

import { SidebarItem } from "./SidebarItem";
import { SidebarFooter } from "./SidebarFooter";

interface MobileSidebarProps {
  groups: ChatGroup[];
  activeChatId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onClearAll: () => void;
}

export function MobileSidebar({
  groups,
  activeChatId,
  open,
  onOpenChange,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  onClearAll,
}: MobileSidebarProps) {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [confirmClear, setConfirmClear] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const totalChats = groups.reduce((n, g) => n + g.chats.length, 0);

  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
    else setSearchQuery("");
  }, [showSearch]);

  // Reset search when drawer closes
  useEffect(() => {
    if (!open) { setShowSearch(false); setSearchQuery(""); }
  }, [open]);

  const displayGroups = searchQuery.trim()
    ? groups
        .map((g) => ({
          ...g,
          chats: g.chats.filter((c) =>
            c.title.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
        }))
        .filter((g) => g.chats.length > 0)
    : groups;

  // Keyboard close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Reset confirm when drawer closes
  useEffect(() => {
    if (!open) setConfirmClear(false);
  }, [open]);

  function close() { onOpenChange(false); }
  function handleSelectChat(id: string) { onSelectChat(id); close(); }
  function handleNewChat() { onNewChat(); close(); }
  function handleClearAll() { onClearAll(); setConfirmClear(false); close(); }

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={close}
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 md:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col overflow-hidden md:hidden",
          "border-r border-zinc-800/70 bg-zinc-950",
          "transition-transform duration-200 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/70 px-3 py-3">
          <div className="flex select-none items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-lg bg-violet-600">
              <Sparkles className="size-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-zinc-100">
              Lumina AI
            </span>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* ── New chat ────────────────────────────────────────────────── */}
        <div className="shrink-0 px-3 py-2">
          <button
            type="button"
            onClick={handleNewChat}
            className="flex w-full items-center gap-2.5 rounded-xl bg-zinc-800/50 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            <MessageSquarePlus className="size-4 shrink-0" />
            New chat
          </button>
        </div>

        {/* ── Nav links ───────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-zinc-800/50 px-3 pb-2">
          <button
            type="button"
            onClick={() => setShowSearch((v) => !v)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-zinc-800/40",
              showSearch ? "bg-zinc-800/50 text-zinc-200" : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            <Search className="size-4 shrink-0" />
            Search
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => { navigate("/admin"); close(); }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-800/40 hover:text-zinc-300"
            >
              <Shield className="size-4 shrink-0" />
              Admin
            </button>
          )}
        </div>

        {/* ── Search input ────────────────────────────────────────────── */}
        {showSearch && (
          <div className="shrink-0 border-b border-zinc-800/50 px-3 py-2">
            <div className="flex items-center gap-2 rounded-xl bg-zinc-800/50 px-3 py-2 ring-1 ring-zinc-700/40 focus-within:ring-violet-500/40">
              <Search className="size-3.5 shrink-0 text-zinc-500" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations…"
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="flex size-4 items-center justify-center text-zinc-500 hover:text-zinc-300"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Conversation list ────────────────────────────────────────── */}
        {displayGroups.length === 0 ? (
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-1.5 px-4 text-center">
            <p className="text-xs font-medium text-zinc-500">
              {searchQuery.trim() ? "No matching conversations" : "No conversations yet"}
            </p>
            {!searchQuery.trim() && <p className="text-xs text-zinc-700">Start a new chat above</p>}
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-2 py-2">
              {displayGroups.map((group) => (
                <div key={group.label} className="mb-4">
                  <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
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
                      onRename={(newTitle) => onRenameChat(chat.id, newTitle)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* ── Clear all ────────────────────────────────────────────────── */}
        {totalChats > 0 && (
          <div className="shrink-0 border-t border-zinc-800/50 px-3 py-2">
            {confirmClear ? (
              <div className="flex items-center justify-between rounded-xl bg-red-950/20 px-3 py-2 ring-1 ring-inset ring-red-900/30">
                <span className="text-xs text-red-400">
                  Delete {totalChats} conversation{totalChats !== 1 ? "s" : ""}?
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-xs font-medium text-red-400 transition-colors hover:text-red-300"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-zinc-600 transition-colors hover:bg-zinc-800/40 hover:text-zinc-400"
              >
                <Trash2 className="size-3 shrink-0" />
                Clear all history
              </button>
            )}
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-zinc-800/70">
          <SidebarFooter collapsed={false} />
        </div>
      </aside>
    </>
  );
}
