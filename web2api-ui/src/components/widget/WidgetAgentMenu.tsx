import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, Plus } from "lucide-react";
import type { UserAgent } from "@/types/chat";

// Theme-aware "New chat" control for the embed widget. Mirrors the main app's
// AgentDropdown pattern (outside-click / Escape close, role=menu) but styles
// itself from the widget's light flag + accent color instead of the app's
// hardcoded dark/orange, so it matches whatever appearance the embed uses.
interface WidgetAgentMenuProps {
  agents: UserAgent[];
  selectedAgentId: string | null;
  accentColor: string;
  light: boolean;
  onNewChat: (agentId: string) => void;
}

export function WidgetAgentMenu({
  agents,
  selectedAgentId,
  accentColor,
  light,
  onNewChat,
}: WidgetAgentMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  function pick(id: string) {
    onNewChat(id);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="New chat"
        title="New chat"
        className={
          light
            ? "flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
            : "flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/5"
        }
        style={{ color: accentColor }}
      >
        <Plus className="size-3.5 shrink-0" />
        <span className="hidden sm:inline">New chat</span>
        <ChevronDown className="size-3 shrink-0 opacity-80" />
      </button>

      {open && (
        <div
          role="menu"
          className={
            light
              ? "absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl"
              : "absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 p-1.5 shadow-xl"
          }
        >
          <div
            className={
              light
                ? "px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400"
                : "px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
            }
          >
            Start a new chat with
          </div>
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {agents.map((agent) => {
              const active = agent.id === selectedAgentId;
              return (
                <button
                  key={agent.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => pick(agent.id)}
                  className={
                    light
                      ? "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-zinc-100"
                      : "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/5"
                  }
                >
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: `${accentColor}22`, color: accentColor }}
                  >
                    <Bot className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={
                        light
                          ? "block truncate text-sm font-medium text-zinc-900"
                          : "block truncate text-sm font-medium text-zinc-100"
                      }
                    >
                      {agent.name}
                    </span>
                    {agent.description && (
                      <span
                        className={
                          light
                            ? "block truncate text-xs text-zinc-500"
                            : "block truncate text-xs text-zinc-400"
                        }
                      >
                        {agent.description}
                      </span>
                    )}
                  </span>
                  {active && (
                    <Check className="size-4 shrink-0" style={{ color: accentColor }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
