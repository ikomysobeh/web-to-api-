import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Image,
  Info,
  Mic,
  MicOff,
  MoreHorizontal,
  Paperclip,
  Plus,
  Sparkles,
  SquareStack,
  X,
} from "lucide-react";
import { useSpeechToText } from "@/hooks/useSpeechToText";

import type { ChatHomeProps } from "@/app/AppShell";
import type { AIModelId, ApiModel } from "@/types/chat";
import { AgentDropdown } from "./AgentDropdown";
import { AI_MODELS } from "@/data/mockChats";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedModel = models.find((m) => m.id === selectedModelId) ?? models[0];

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
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

  function selectModel(id: AIModelId) {
    onModelChange(id);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Current model: ${selectedModel.name}`}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1.5",
          "text-xs font-semibold text-zinc-100 transition-colors",
          "hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <span className="max-w-36 truncate">{selectedModel.name}</span>
        <ChevronDown className="size-3.5 text-zinc-400" />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-full left-0 z-50 mt-2 w-64 overflow-hidden rounded-3xl",
            "border border-zinc-800 bg-zinc-900 p-2 shadow-2xl shadow-black/40",
          )}
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
                    "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
                    model.available
                      ? "hover:bg-zinc-800 focus-visible:bg-zinc-800 focus-visible:outline-none"
                      : "cursor-not-allowed opacity-40",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {active && <Check className="size-4 text-zinc-100" />}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-100">
                      {model.name}
                    </span>
                    <span className="block truncate text-xs text-zinc-400">
                      {model.available ? model.description : "Connect Gemini to use"}
                    </span>
                  </span>

                  {model.badge && (
                    <Badge className="rounded-full bg-zinc-700 px-2 py-0.5 text-[10px] font-semibold text-zinc-200 hover:bg-zinc-700">
                      {model.badge}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>

          <div className="my-2 h-px bg-zinc-800" />

          <button
            type="button"
            className="flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left hover:bg-zinc-800"
          >
            <span>
              <span className="block text-sm font-semibold text-zinc-100">
                Thinking level
              </span>
              <span className="block text-xs text-zinc-400">Standard</span>
            </span>
            <ChevronDown className="-rotate-90 size-4 text-zinc-400" />
          </button>
        </div>
      )}
    </div>
  );
}

function UploadMenu({
  open,
  onOpenChange,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [moreUploadsOpen, setMoreUploadsOpen] = useState(false);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
        setMoreUploadsOpen(false);
      }
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
        setMoreUploadsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onOpenChange]);

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onClick={() => onOpenChange(!open)}
            aria-label={open ? "Close upload menu" : "Open upload menu"}
            aria-haspopup="menu"
            aria-expanded={open}
            className="mb-0.5 shrink-0 rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            {open ? <X className="size-5" /> : <Plus className="size-5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Add content</TooltipContent>
      </Tooltip>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-50 mt-3 w-64 rounded-3xl border border-zinc-800 bg-zinc-900 p-2 shadow-2xl shadow-black/50"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
          >
            <Paperclip className="size-4 text-zinc-300" />
            <span className="flex-1">Upload files</span>
            <Info className="size-4 text-zinc-400" />
          </button>

          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
          >
            <SquareStack className="size-4 text-zinc-300" />
            <span>Add from Drive</span>
          </button>

          <div
            onMouseEnter={() => setMoreUploadsOpen(true)}
            onMouseLeave={() => setMoreUploadsOpen(false)}
            className="relative"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => setMoreUploadsOpen((value) => !value)}
              className="flex w-full items-center gap-3 rounded-2xl bg-zinc-800 px-3 py-2.5 text-left text-sm font-semibold text-zinc-100"
            >
              <MoreHorizontal className="size-4 text-zinc-300" />
              <span className="flex-1">More uploads</span>
              <ChevronRight className="size-4 text-zinc-300" />
            </button>

            {moreUploadsOpen && (
              <div className="absolute bottom-0 left-full ml-2 w-52 rounded-3xl border border-zinc-800 bg-zinc-900 p-2 shadow-2xl shadow-black/50">
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
                >
                  <Image className="size-4 text-zinc-300" />
                  Photos
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
                >
                  <SquareStack className="size-4 text-zinc-300" />
                  Notebooks
                </button>
              </div>
            )}
          </div>

          <div className="my-2 h-px bg-zinc-800" />

          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
          >
            <Image className="size-4 text-zinc-300" />
            <span className="flex-1">Create image</span>
            <Badge className="rounded-full bg-zinc-700 px-2 py-0.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700">
              New
            </Badge>
          </button>

          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
          >
            <SquareStack className="size-4 text-zinc-300" />
            Canvas
          </button>

          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
          >
            <MoreHorizontal className="size-4 text-zinc-300" />
            <span className="flex-1">More tools</span>
            <ChevronRight className="size-4 text-zinc-300" />
          </button>
        </div>
      )}
    </div>
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
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
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
          "relative h-full overflow-y-auto bg-zinc-950",
          "before:pointer-events-none before:absolute before:inset-0",
          "before:bg-[radial-gradient(ellipse_150%_90%_at_50%_-20%,rgba(124,58,237,0.18),rgba(59,130,246,0.08),transparent)]",
        )}
      >
        <div className="relative z-10 mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center gap-10 px-4 py-16 sm:px-6">

          {/* ── Greeting ─────────────────────────────────────────────────── */}
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-violet-600 shadow-lg shadow-violet-900/40">
              <Sparkles className="size-6 text-white" />
            </div>

            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl leading-tight">
              What can I help with,{" "}
              <span className="text-violet-400">Naya?</span>
            </h1>

            <p className="max-w-xl text-base text-zinc-400">
              Ask me anything — powered by Lumina AI.
            </p>
          </div>

          {/* ── Prompt input with model chip ─────────────────────────────── */}
          <div
            className={cn(
              "flex w-full flex-col rounded-3xl bg-zinc-900/80 border border-white/5 px-3 pb-3 pt-3",
              "shadow-[0_20px_80px_-50px_rgba(124,58,237,0.35)] ring-1 ring-zinc-700/30",
              "transition-all duration-200 focus-within:ring-violet-500/30",
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
              <UploadMenu
                open={uploadMenuOpen}
                onOpenChange={setUploadMenuOpen}
                disabled={disabled}
              />

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
                        className="size-8 rounded-full bg-violet-600 text-white transition-colors hover:bg-violet-500"
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
            <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-400">
              Enter
            </kbd>{" "}
            to send ·{" "}
            <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-400">
              Shift+Enter
            </kbd>{" "}
            for new line
          </p>

        </div>
      </div>
    </TooltipProvider>
  );
}