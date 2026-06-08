import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Image,
  Info,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  SquareStack,
  X,
} from "lucide-react";

import type { AIModelId } from "@/types/chat";
import { AI_MODELS } from "@/data/mockChats";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
}

function ModelDropdown({
  selectedModelId,
  onModelChange,
  disabled,
}: {
  selectedModelId: AIModelId;
  onModelChange: (id: AIModelId) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedModel =
    AI_MODELS.find((model) => model.id === selectedModelId) ?? AI_MODELS[0];

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
          className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 p-2 shadow-2xl shadow-black/40"
        >
          <div className="space-y-1">
            {AI_MODELS.map((model) => {
              const active = model.id === selectedModelId;

              return (
                <button
                  key={model.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => selectModel(model.id)}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-zinc-800 focus-visible:bg-zinc-800 focus-visible:outline-none"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {active && <Check className="size-4 text-zinc-100" />}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-100">
                      {model.name}
                    </span>
                    <span className="block truncate text-xs text-zinc-400">
                      {model.description}
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
            <ChevronRight className="size-4 text-zinc-400" />
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
          className="absolute bottom-full left-0 z-50 mb-3 w-64 rounded-3xl border border-zinc-800 bg-zinc-900 p-2 shadow-2xl shadow-black/50"
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

export function ChatInput({
  onSubmit,
  placeholder = "Ask Lumina anything…",
  disabled = false,
  initialValue = "",
  selectedModelId,
  onModelChange,
}: ChatInputProps) {
  const [value, setValue] = useState(initialValue);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
          "flex w-full flex-col rounded-4xl bg-zinc-900/90 border border-white/5 px-3 pb-3 pt-3",
          "shadow-[0_18px_60px_-40px_rgba(124,58,237,0.35)] ring-1 ring-zinc-700/30",
          "transition-all duration-200 focus-within:ring-violet-500/30",
          disabled && "opacity-60",
        )}
      >
        <div className="px-1 pb-1.5">
          <ModelDropdown
            selectedModelId={selectedModelId}
            onModelChange={onModelChange}
            disabled={disabled}
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
            {!canSend && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label="Use microphone"
                    className="rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    <Mic className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Use microphone</TooltipContent>
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