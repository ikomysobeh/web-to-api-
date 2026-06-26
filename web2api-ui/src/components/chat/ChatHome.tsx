import { useEffect, useRef, useState, type KeyboardEvent, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Mic,
  MicOff,
  Sparkles,
} from "lucide-react";
import { useSpeechToText } from "@/hooks/useSpeechToText";

import type { ChatHomeProps } from "@/app/AppShell";
import type { AIModelId, ApiModel } from "@/types/chat";
import { AgentDropdown } from "./AgentDropdown";
import { AI_MODELS } from "@/data/mockChats";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ModelChip — same compact cycler as in ChatInput
// ---------------------------------------------------------------------------

const DROPDOWN_WIDTH = 256;
const DROPDOWN_EST_HEIGHT = 320;

function ModelDropdown({
  selectedModelId,
  onModelChange,
  disabled,
  models,
}: {
  selectedModelId: AIModelId;
  onModelChange: (id: AIModelId) => void;
  disabled?: boolean;
  models: ApiModel[];
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedModel = models.find((m) => m.id === selectedModelId) ?? models[0];

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent | globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function handleToggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const GAP = 8;
      const spaceBelow = window.innerHeight - rect.bottom - GAP;
      const spaceAbove = rect.top - GAP;
      const openDown = spaceBelow >= spaceAbove;
      if (openDown) {
        setMenuStyle({
          top: rect.bottom + GAP,
          left: rect.left,
          maxHeight: Math.min(DROPDOWN_EST_HEIGHT, spaceBelow),
          overflowY: "auto",
        });
      } else {
        setMenuStyle({
          bottom: window.innerHeight - rect.top + GAP,
          left: rect.left,
          maxHeight: Math.min(DROPDOWN_EST_HEIGHT, spaceAbove),
          overflowY: "auto",
        });
      }
    }
    setOpen((v) => !v);
  }

  function selectModel(id: AIModelId) {
    onModelChange(id);
    setOpen(false);
  }

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: "fixed", width: DROPDOWN_WIDTH, zIndex: 9999, ...menuStyle }}
          className="glass-strong rounded-2xl p-2 shadow-2xl"
        >
          <div className="space-y-1">
            {models.map((model) => {
              const active = model.id === selectedModelId;
              return (
                <button
                  key={model.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  disabled={!model.available}
                  onClick={() => model.available && selectModel(model.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                    model.available
                      ? "hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none"
                      : "cursor-not-allowed opacity-40",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {active && <Check className="size-4 text-violet-400" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-100">
                      {model.name}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {model.available ? model.description : "Connect Gemini to use"}
                    </span>
                  </span>
                  {model.badge && (
                    <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-300">
                      {model.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Current model: ${selectedModel.name}`}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1.5",
          "text-xs font-semibold text-zinc-100 transition-colors",
          "hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
          open && "bg-zinc-700",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <span className="max-w-36 truncate">{selectedModel.name}</span>
        <ChevronDown
          className={cn(
            "size-3.5 text-zinc-400 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {menu}
    </>
  );
}

// ---------------------------------------------------------------------------
// ChatHome — Gemini-style empty / welcome state
// ---------------------------------------------------------------------------

export function ChatHome({ onSendMessage, selectedModelId, onModelChange, disabled = false, availableModels, myAgents, selectedAgentId, onAgentChange }: ChatHomeProps) {
  const models: ApiModel[] = availableModels?.length
    ? availableModels
    : AI_MODELS.map((m) => ({ ...m, badge: m.badge ?? "", available: true }));

  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { listening, supported: micSupported, toggle: toggleMic } = useSpeechToText(
    (text) => setValue((prev) => (prev ? prev + " " + text : text)),
  );

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setValue("");

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput() {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  const canSend = !disabled && value.trim().length > 0;

  return (
    <TooltipProvider>
      <div
        className={cn(
          "relative h-full overflow-y-auto",
          "before:pointer-events-none before:absolute before:inset-0",
          "before:bg-[radial-gradient(ellipse_150%_90%_at_50%_-20%,rgba(124,58,237,0.15),rgba(59,130,246,0.06),transparent)]",
        )}
      >
        <div className="relative z-10 mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center gap-10 px-4 py-16 sm:px-6">

          {/* ── Greeting ─────────────────────────────────────────────────── */}
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-900/50">
              <Sparkles className="size-6 text-white" />
            </div>

            <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight text-white sm:text-5xl leading-tight">
              What can I help{" "}
              <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-indigo-300 bg-clip-text text-transparent">
                with?
              </span>
            </h1>

            <p className="max-w-xl text-base text-zinc-400">
              Ask me anything — powered by Lumina AI.
            </p>
          </div>

          {/* ── Prompt input with model chip ─────────────────────────────── */}
          <div
            className={cn(
              "glass flex w-full flex-col rounded-3xl px-3 pb-3 pt-3",
              "transition-all duration-200 focus-within:border-violet-400/30 focus-within:shadow-[0_0_0_1px_rgba(167,139,250,0.25),0_20px_60px_-30px_rgba(124,58,237,0.55)]",
              disabled && "opacity-60",
            )}
          >
            <div className="flex flex-wrap items-center gap-2 px-1 pb-1.5">
              {myAgents.length > 0 && (
                <AgentDropdown
                  myAgents={myAgents}
                  selectedAgentId={selectedAgentId ?? null}
                  onAgentChange={onAgentChange}
                  disabled={disabled}
                />
              )}
              <ModelDropdown
                selectedModelId={selectedModelId}
                onModelChange={onModelChange}
                disabled={disabled || !!selectedAgentId}
                models={models}
              />
            </div>

            <div className="flex items-end gap-1">
              <Textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onInput={handleInput}
                placeholder="Ask Lumina anything…"
                disabled={disabled}
                rows={1}
                aria-label="Message input"
                aria-multiline="true"
                aria-disabled={disabled}
                className={cn(
                  "min-h-7 max-h-52 flex-1 resize-none overflow-y-auto border-0 bg-transparent p-0 py-1.5",
                  "text-sm text-zinc-100 placeholder:text-zinc-500",
                  "transition-[height] duration-100 focus-visible:border-0 focus-visible:ring-0",
                )}
              />

              <div className="mb-0.5 flex shrink-0 items-center gap-0.5">
                {!canSend && micSupported && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        onClick={toggleMic}
                        aria-label={listening ? "Stop recording" : "Use microphone"}
                        className={cn(
                          "rounded-full hover:bg-zinc-800",
                          listening
                            ? "animate-pulse text-red-400 hover:text-red-300"
                            : "text-zinc-400 hover:text-zinc-100",
                        )}
                      >
                        {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {listening ? "Stop recording" : "Use microphone"}
                    </TooltipContent>
                  </Tooltip>
                )}

                {canSend && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        onClick={handleSend}
                        aria-label="Send message"
                        className="size-8 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-950/50 transition-all hover:shadow-violet-900/60 active:scale-95"
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Send (Enter)</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>

          {/* ── Keyboard hint ──────────────────────────────────────────── */}
          <p className="text-center text-xs text-zinc-600">
            Press{" "}
            <kbd className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-zinc-400 ring-1 ring-inset ring-white/10">
              Enter
            </kbd>{" "}
            to send ·{" "}
            <kbd className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-zinc-400 ring-1 ring-inset ring-white/10">
              Shift+Enter
            </kbd>{" "}
            for new line
          </p>

        </div>
      </div>
    </TooltipProvider>
  );
}