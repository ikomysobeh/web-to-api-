import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

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
  onRenameChat: (id: string, title: string) => void;
  onClearAll: () => void;
}

// ── Collapsed icon sidebar ──────────────────────────────────────────────────
function CollapsedSidebar({
  onNewChat,
  onToggleCollapse,
  isAdmin,
  onNavigateAdmin,
}: {
  onNewChat: () => void;
  onToggleCollapse: () => void;
  isAdmin: boolean | null;
  onNavigateAdmin: () => void;
}) {
  return (
    <aside className="flex h-full w-14 shrink-0 flex-col items-center overflow-hidden border-r border-zinc-800/70 bg-zinc-950">
      {/* Logo mark */}
      <div className="flex shrink-0 flex-col items-center border-b border-zinc-800/70 py-3">
        <div className="flex size-7 items-center justify-center rounded-lg bg-violet-600">
          <Sparkles className="size-3.5 text-white" />
        </div>
      </div>

      {/* Icon actions */}
      <div className="flex flex-col items-center gap-0.5 py-2">
        <IconBtn icon={ChevronRight} label="Expand sidebar" onClick={onToggleCollapse} />
        <IconBtn icon={MessageSquarePlus} label="New chat" onClick={onNewChat} />
        {/* Search expands the sidebar first */}
        <IconBtn icon={Search} label="Search" onClick={onToggleCollapse} />
        {isAdmin && (
          <IconBtn icon={Shield} label="Admin" onClick={onNavigateAdmin} />
        )}
      </div>

      <div className="flex-1" />

      <div className="w-full border-t border-zinc-800/70">
        <SidebarFooter collapsed />
      </div>
    </aside>
  );
}

function IconBtn({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="flex size-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

// ── Expanded sidebar ────────────────────────────────────────────────────────
export function Sidebar({
  groups,
  activeChatId,
  collapsed,
  onSelectChat,
  onNewChat,
  onToggleCollapse,
  onDeleteChat,
  onRenameChat,
  onClearAll,
}: SidebarProps) {
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

  if (collapsed) {
    return (
      <CollapsedSidebar
        onNewChat={onNewChat}
        onToggleCollapse={onToggleCollapse}
        isAdmin={isAdmin}
        onNavigateAdmin={() => navigate("/admin")}
      />
    );
  }

  function handleClearAll() {
    onClearAll();
    setConfirmClear(false);
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-zinc-800/70 bg-zinc-950">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/70 px-3 py-3">
        <div className="flex select-none items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-violet-600">
            <Sparkles className="size-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-zinc-100">
            Lumina AI
          </span>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
              className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-300"
            >
              <ChevronLeft className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Collapse</TooltipContent>
        </Tooltip>
      </div>

      {/* ── New chat button ──────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 py-2">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2.5 rounded-xl bg-zinc-800/50 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
        >
          <MessageSquarePlus className="size-4 shrink-0" />
          New chat
        </button>
      </div>

      {/* ── Nav links ────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-zinc-800/50 px-3 pb-2">
        <NavBtn
          icon={Search}
          label="Search"
          active={showSearch}
          onClick={() => setShowSearch((v) => !v)}
        />
        {isAdmin && (
          <NavBtn
            icon={Shield}
            label="Admin"
            onClick={() => navigate("/admin")}
          />
        )}
      </div>

      {/* ── Search input ─────────────────────────────────────────────────── */}
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

      {/* ── Conversation list ─────────────────────────────────────────────── */}
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
                    onClick={() => onSelectChat(chat.id)}
                    onDelete={() => onDeleteChat(chat.id)}
                    onRename={(newTitle) => onRenameChat(chat.id, newTitle)}
                  />
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* ── Clear all history ─────────────────────────────────────────────── */}
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

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-zinc-800/70">
        <SidebarFooter collapsed={false} />
      </div>
    </aside>
  );
}

function NavBtn({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-zinc-800/40",
        active ? "bg-zinc-800/50 text-zinc-200" : "text-zinc-500 hover:text-zinc-300",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}
