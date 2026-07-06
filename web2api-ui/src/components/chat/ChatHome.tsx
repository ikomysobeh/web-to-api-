import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUp,
  Compass,
  Lightbulb,
  MessageCircleQuestion,
  Mic,
  MicOff,
  Rocket,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useSpeechToText } from "@/hooks/useSpeechToText";

import type { ChatHomeProps } from "@/app/AppShell";
import type { Suggestion } from "@/types/chat";
import { getMyAgentSuggestions } from "@/services/api";
import { AgentDropdown } from "./AgentDropdown";
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
// Suggestion card accents — cycled per card for a colorful, varied grid
// ---------------------------------------------------------------------------

const SUGGESTION_ACCENTS = [
  { icon: Sparkles, iconBg: "bg-orange-500/15 text-orange-300", ring: "hover:ring-orange-400/30" },
  { icon: Lightbulb, iconBg: "bg-amber-500/15 text-amber-300", ring: "hover:ring-amber-400/30" },
  { icon: MessageCircleQuestion, iconBg: "bg-yellow-500/15 text-yellow-300", ring: "hover:ring-yellow-400/30" },
  { icon: Wand2, iconBg: "bg-emerald-500/15 text-emerald-300", ring: "hover:ring-emerald-400/30" },
  { icon: Rocket, iconBg: "bg-rose-500/15 text-rose-300", ring: "hover:ring-rose-400/30" },
  { icon: Compass, iconBg: "bg-orange-500/15 text-orange-300", ring: "hover:ring-orange-400/30" },
] as const;

// ---------------------------------------------------------------------------
// ChatHome — Gemini-style empty / welcome state
// ---------------------------------------------------------------------------

export function ChatHome({ onSendMessage, disabled = false, myAgents, selectedAgentId, onAgentChange }: ChatHomeProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Starter-question chips for the selected agent
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  useEffect(() => {
    if (!selectedAgentId) {
      setSuggestions([]);
      return;
    }
    const token = localStorage.getItem("auth_token") ?? "";
    if (!token) return;
    let cancelled = false;
    getMyAgentSuggestions(token, selectedAgentId)
      .then((data) => {
        if (!cancelled) setSuggestions(data.suggestions);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => { cancelled = true; };
  }, [selectedAgentId]);

  function applySuggestion(question: string) {
    setValue(question);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }

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
          "before:bg-[radial-gradient(ellipse_150%_90%_at_50%_-20%,rgba(234,88,12,0.15),rgba(245,158,11,0.06),transparent)]",
        )}
      >
        <div className="relative z-10 mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center gap-10 px-4 py-16 sm:px-6">

          {/* ── Greeting ─────────────────────────────────────────────────── */}
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 shadow-lg shadow-orange-900/50">
              <Sparkles className="size-6 text-white" />
            </div>

            <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight text-white sm:text-5xl leading-tight">
              What can I help{" "}
              <span className="bg-gradient-to-r from-orange-300 via-amber-300 to-orange-300 bg-clip-text text-transparent">
                with?
              </span>
            </h1>

            <p className="max-w-xl text-base text-zinc-400">
              Ask me anything — powered by PNE LC AI.
            </p>
          </div>

          {/* ── Prompt input ─────────────────────────────────────────────── */}
          <div
            className={cn(
              "glass flex w-full flex-col rounded-3xl px-3 pb-3 pt-3",
              "transition-all duration-200 focus-within:border-orange-400/30 focus-within:shadow-[0_0_0_1px_rgba(251,146,60,0.25),0_20px_60px_-30px_rgba(234,88,12,0.55)]",
              disabled && "opacity-60",
            )}
          >
            {myAgents.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-1 pb-1.5">
                <AgentDropdown
                  myAgents={myAgents}
                  selectedAgentId={selectedAgentId ?? null}
                  onAgentChange={onAgentChange}
                  disabled={disabled}
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
                placeholder="Ask PNE LC AI anything…"
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

          {/* ── Suggestion cards (for the selected agent) ───────────────── */}
          {suggestions.length > 0 && (
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
              {suggestions.map((s, i) => {
                const accent = SUGGESTION_ACCENTS[i % SUGGESTION_ACCENTS.length];
                const Icon = accent.icon;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => applySuggestion(s.question)}
                    className={cn(
                      "glass group flex items-start gap-3 rounded-2xl p-4 text-left ring-1 ring-inset ring-white/10",
                      "transition-all hover:-translate-y-0.5 hover:bg-white/[0.06] hover:shadow-lg hover:shadow-black/20",
                      accent.ring,
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105",
                        accent.iconBg,
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="pt-0.5 text-sm text-zinc-300 transition-colors group-hover:text-zinc-100">
                      {s.question}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

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