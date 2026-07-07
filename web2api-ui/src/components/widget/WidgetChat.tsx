import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, MessageCircleQuestion, Sparkles } from "lucide-react";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import type { Suggestion } from "@/types/chat";

export interface WidgetMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface WidgetChatProps {
  title: string;
  greeting: string;
  accentColor: string;
  theme: "dark" | "light";
  messages: WidgetMessage[];
  busy: boolean;
  suggestions?: Suggestion[];
  onSend: (text: string) => void;
}

export function WidgetChat({
  title,
  greeting,
  accentColor,
  theme,
  messages,
  busy,
  suggestions = [],
  onSend,
}: WidgetChatProps) {
  const [value, setValue] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const light = theme === "light";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send() {
    const t = value.trim();
    if (!t || busy) return;
    onSend(t);
    setValue("");
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
  function sendSuggestion(question: string) {
    if (busy) return;
    onSend(question);
  }

  return (
    <div className={light ? "flex h-full flex-col bg-white text-zinc-900" : "flex h-full flex-col bg-zinc-950 text-zinc-100"}>
      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-4 py-3 text-white"
        style={{ background: accentColor }}
      >
        <div className="flex size-7 items-center justify-center rounded-lg bg-white/20">
          <Sparkles className="size-4" />
        </div>
        <span className="text-sm font-semibold">{title}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3">
            <div className={light ? "text-sm text-zinc-500" : "text-sm text-zinc-400"}>{greeting}</div>
            {suggestions.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => sendSuggestion(s.question)}
                    disabled={busy}
                    className={
                      light
                        ? "flex items-start gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50"
                        : "flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left text-sm text-zinc-300 transition-colors hover:bg-white/[0.07] hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-50"
                    }
                  >
                    <MessageCircleQuestion className="mt-0.5 size-3.5 shrink-0" style={{ color: accentColor }} />
                    <span>{s.question}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm text-white"
                  : light
                    ? "max-w-[85%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-3.5 py-2 text-sm text-zinc-900"
                    : "max-w-[85%] whitespace-pre-wrap rounded-2xl bg-white/5 px-3.5 py-2 text-sm text-zinc-100"
              }
              style={m.role === "user" ? { background: accentColor } : undefined}
            >
              {m.role === "assistant" && m.content ? (
                <MarkdownMessage content={m.content} />
              ) : m.role === "assistant" && !m.content && busy ? (
                <span
                  className="flex items-center gap-1 py-0.5"
                  role="status"
                  aria-label="Assistant is typing"
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="size-1.5 animate-bounce rounded-full"
                      style={{ background: accentColor, animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </span>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className={light ? "border-t border-zinc-200 p-3" : "border-t border-white/10 p-3"}>
        <div
          className={
            light
              ? "flex items-end gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2"
              : "flex items-end gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
          }
        >
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a message…"
            rows={1}
            className={
              light
                ? "max-h-28 flex-1 resize-none border-0 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
                : "max-h-28 flex-1 resize-none border-0 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
            }
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || !value.trim()}
            aria-label="Send"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
            style={{ background: accentColor }}
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
