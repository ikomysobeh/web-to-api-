import { useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUp,
  Mic,
  MicOff,
} from "lucide-react";
import { useSpeechToText } from "@/hooks/useSpeechToText";

import type { AIModelId, ApiModel, UserAgent } from "@/types/chat";
import { AgentDropdown } from "./AgentDropdown";
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

export function ChatInput({
  onSubmit,
  placeholder = "Ask PNE LC AI anything…",
  disabled = false,
  initialValue = "",
  myAgents = [],
  selectedAgentId = null,
  onAgentChange,
  agentLocked = false,
}: ChatInputProps) {
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
          "transition-all duration-200 focus-within:border-orange-400/30 focus-within:shadow-[0_0_0_1px_rgba(251,146,60,0.25),0_16px_40px_-20px_rgba(234,88,12,0.5)]",
          disabled && "opacity-60",
        )}
      >
        {myAgents.length > 0 && (!agentLocked || selectedAgentId) && (
          <div className="flex flex-wrap items-center gap-2 px-1 pb-1.5">
            <AgentDropdown
              myAgents={myAgents}
              selectedAgentId={selectedAgentId}
              onAgentChange={onAgentChange ?? (() => {})}
              disabled={disabled}
              dropUp
              locked={agentLocked}
            />
          </div>
        )}

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
                    className="size-8 rounded-full bg-gradient-to-br from-orange-600 to-amber-600 text-white shadow-lg shadow-orange-950/50 transition-all hover:shadow-orange-900/60 active:scale-95"
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