import { useEffect, useRef, useState, type KeyboardEvent, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Mic,
  MicOff,
} from "lucide-react";
import { useSpeechToText } from "@/hooks/useSpeechToText";

import type { AIModelId, ApiModel, UserAgent } from "@/types/chat";
import { AgentDropdown } from "./AgentDropdown";
import { AI_MODELS } from "@/data/mockChats";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ChatInputProps {
  onSubmit: (content: string) => void;
  placeholder?: string;
  disabled?: boolean;
  initialValue?: string;
  selectedModelId: AIModelId;
  onModelChange: (id: AIModelId) => void;
  availableModels?: ApiModel[];
  myAgents?: UserAgent[];
  selectedAgentId?: string | null;
  onAgentChange?: (id: string | null) => void;
  agentLocked?: boolean;
}

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

  const selectedModel =
    models.find((m) => m.id === selectedModelId) ?? models[0];

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

export function ChatInput({
  onSubmit,
  placeholder = "Ask Lumina anything…",
  disabled = false,
  initialValue = "",
  selectedModelId,
  onModelChange,
  availableModels,
  myAgents = [],
  selectedAgentId = null,
  onAgentChange,
  agentLocked = false,
}: ChatInputProps) {
  // Fall back to static AI_MODELS while API models are loading
  const models: ApiModel[] = availableModels?.length
    ? availableModels
    : AI_MODELS.map((m) => ({ ...m, badge: m.badge ?? "", available: true }));
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { listening, supported: micSupported, toggle: toggleMic } = useSpeechToText(
    (text) => setValue((prev) => (prev ? prev + " " + text : text)),
  );

  const canSend = !disabled && value.trim().length > 0;

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    onSubmit(trimmed);
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

  return (
    <>
      <div
        role="group"
        aria-label="Chat input"
        className={cn(
          "glass flex w-full flex-col rounded-4xl px-3 pb-3 pt-3",
          "transition-all duration-200 focus-within:border-violet-400/30 focus-within:shadow-[0_0_0_1px_rgba(167,139,250,0.25),0_16px_40px_-20px_rgba(124,58,237,0.5)]",
          disabled && "opacity-60",
        )}
      >
        <div className="flex flex-wrap items-center gap-2 px-1 pb-1.5">
          {myAgents.length > 0 && (!agentLocked || selectedAgentId) && (
            <AgentDropdown
              myAgents={myAgents}
              selectedAgentId={selectedAgentId}
              onAgentChange={onAgentChange ?? (() => {})}
              disabled={disabled}
              dropUp
              locked={agentLocked}
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
            placeholder={placeholder}
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

      <p className="mt-1.5 text-center text-xs text-zinc-600">
        <kbd className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-zinc-500">
          Enter
        </kbd>{" "}
        to send ·{" "}
        <kbd className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-zinc-500">
          Shift+Enter
        </kbd>{" "}
        for new line
      </p>
    </>
  );
}