import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserAgent } from "@/types/chat";

interface AgentDropdownProps {
  myAgents: UserAgent[];
  selectedAgentId: string | null;
  onAgentChange: (id: string | null) => void;
  disabled?: boolean;
  dropUp?: boolean;
  locked?: boolean;
}

export function AgentDropdown({
  myAgents,
  selectedAgentId,
  onAgentChange,
  disabled,
  dropUp = false,
  locked = false,
}: AgentDropdownProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selectedAgent = myAgents.find((a) => a.id === selectedAgentId) ?? null;

  // Once a conversation has started, the agent is fixed — show a static chip
  // (no dropdown, no clear button).
  if (locked) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-violet-600/25 px-3 py-1.5 text-xs font-semibold text-violet-300 ring-1 ring-inset ring-violet-500/30"
        aria-label={selectedAgent ? `Agent: ${selectedAgent.name}` : "Agent"}
      >
        <Bot className="size-3.5 shrink-0" />
        <span className="max-w-28 truncate">{selectedAgent ? selectedAgent.name : "Agent"}</span>
      </span>
    );
  }

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={selectedAgent ? `Agent: ${selectedAgent.name}` : "Select agent"}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
          selectedAgent
            ? "bg-violet-600/25 text-violet-300 ring-1 ring-inset ring-violet-500/30 hover:bg-violet-600/35"
            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <Bot className="size-3.5 shrink-0" />
        <span className="max-w-28 truncate">
          {selectedAgent ? selectedAgent.name : "Agent"}
        </span>
        {selectedAgent ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear agent"
            onClick={(e) => {
              e.stopPropagation();
              onAgentChange(null);
              setOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onAgentChange(null);
                setOpen(false);
              }
            }}
            className="shrink-0 text-violet-400 hover:text-violet-100"
          >
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-zinc-500" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "glass-strong absolute left-0 z-50 w-64 overflow-hidden rounded-3xl p-2",
            dropUp ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          <div className="space-y-1">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={selectedAgentId === null}
              onClick={() => { onAgentChange(null); setOpen(false); }}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-zinc-800"
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {selectedAgentId === null && <Check className="size-4 text-zinc-100" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-zinc-100">
                  No agent
                </span>
                <span className="block truncate text-xs text-zinc-400">
                  Use model directly
                </span>
              </span>
            </button>

            {myAgents.map((agent) => {
              const active = agent.id === selectedAgentId;
              return (
                <button
                  key={agent.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => { onAgentChange(agent.id); setOpen(false); }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-zinc-800"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {active && <Check className="size-4 text-zinc-100" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-100">
                      {agent.name}
                    </span>
                    {agent.description && (
                      <span className="block truncate text-xs text-zinc-400">
                        {agent.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
