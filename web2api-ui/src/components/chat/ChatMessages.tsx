import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

import type { ChatMessage } from "@/types/chat";
import type { ChatMessagesProps } from "@/app/AppShell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ChatInput } from "./ChatInput";

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function InlineText({ text }: { text: string }) {
  const segments = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.startsWith("**") && seg.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold text-zinc-100">
              {seg.slice(2, -2)}
            </strong>
          );
        }

        if (seg.startsWith("`") && seg.endsWith("`")) {
          return (
            <code
              key={i}
              className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[0.8em] text-violet-300"
            >
              {seg.slice(1, -1)}
            </code>
          );
        }

        return <span key={i}>{seg}</span>;
      })}
    </>
  );
}

function MessageContent({ content }: { content: string }) {
  const blocks = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, bi) => {
        if (block.startsWith("```") && block.endsWith("```")) {
          const inner = block.slice(3, -3);
          const newline = inner.indexOf("\n");
          const code = newline !== -1 ? inner.slice(newline + 1) : inner;
          const lang = newline !== -1 ? inner.slice(0, newline).trim() : "";

          return (
            <div
              key={bi}
              className="overflow-hidden rounded-xl bg-zinc-950 ring-1 ring-zinc-800"
            >
              {lang && (
                <div className="border-b border-zinc-800 px-4 py-1.5 text-xs font-medium text-zinc-500">
                  {lang}
                </div>
              )}
              <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-zinc-200">
                <code>{code.trimEnd()}</code>
              </pre>
            </div>
          );
        }

        const lines = block.split("\n");

        return (
          <p key={bi} className="leading-relaxed text-zinc-300">
            {lines.map((line, li) => (
              <span key={li}>
                {li > 0 && <br />}
                <InlineText text={line} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function MessageBubble({
  message,
  onDelete,
}: {
  message: ChatMessage;
  onDelete: () => void;
}) {
  const isUser = message.role === "user";
  const isSending = message.status === "sending";
  const isDone = message.status === "done" || message.status === "error";

  return (
    <div
      className={cn(
        "group flex w-full gap-3",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {isUser ? (
        <Avatar className="mt-0.5 size-6 shrink-0 ring-1 ring-zinc-700">
          <AvatarFallback className="bg-violet-600 text-xs font-semibold text-white">
            NS
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-600 ring-1 ring-violet-500/40">
          <Sparkles className="size-3.5 text-white" />
        </div>
      )}

      <div
        className={cn(
          "flex max-w-[78%] flex-col gap-1",
          isUser ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm",
            isUser
              ? "rounded-tr-sm bg-zinc-950/80 ring-1 ring-zinc-800/50 text-zinc-100"
              : "rounded-tl-sm bg-zinc-950/70 ring-1 ring-zinc-800/40 text-zinc-300",
            isSending && "animate-pulse opacity-60",
          )}
        >
          {isSending ? (
            <div className="flex items-center gap-1 py-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 rounded-full bg-zinc-500"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          ) : (
            <MessageContent content={message.content} />
          )}
        </div>

        <div
          className={cn(
            "flex items-center gap-2 px-1",
            isUser ? "flex-row-reverse" : "flex-row",
          )}
        >
          <time
            dateTime={message.createdAt.toISOString()}
            className="text-xs text-zinc-600"
          >
            {formatTime(message.createdAt)}
          </time>

          {/* Delete button — visible on hover, only for completed messages */}
          {isDone && (
            <button
              type="button"
              aria-label="Delete message"
              onClick={onDelete}
              className="opacity-0 group-hover:opacity-100 flex size-5 items-center justify-center rounded-md text-zinc-700 transition-all hover:bg-zinc-800 hover:text-red-400"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatMessages({
  session,
  onSendMessage,
  selectedModelId,
  onModelChange,
  onDeleteMessage,
  onLoadMore,
  hasMore,
  isLoadingMore,
  availableModels,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [confirmMsgId, setConfirmMsgId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.messages]);

  const isEmpty = session.messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-8 pt-6 sm:px-6">

          {/* Load older messages */}
          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-xs text-zinc-500 transition-colors hover:border-zinc-700 hover:bg-zinc-800/50 hover:text-zinc-300 disabled:pointer-events-none disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : null}
                {isLoadingMore ? "Loading…" : "Load older messages"}
              </button>
            </div>
          )}

          {/* Confirm delete message dialog */}
          <ConfirmDialog
            open={confirmMsgId !== null}
            title="Delete message"
            description="This message will be permanently deleted."
            onConfirm={() => { onDeleteMessage(confirmMsgId!); setConfirmMsgId(null); }}
            onCancel={() => setConfirmMsgId(null)}
          />

          {isEmpty ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 py-24 text-center">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-violet-600/20">
                <Sparkles className="size-5 text-violet-400" />
              </div>
              <p className="text-sm text-zinc-500">
                No messages yet. Start the conversation below.
              </p>
            </div>
          ) : (
            session.messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onDelete={() => setConfirmMsgId(msg.id)}
              />
            ))
          )}

          <div ref={bottomRef} className="h-1" />
        </div>
      </div>

      <div className="shrink-0 border-t border-zinc-800/70 bg-zinc-950/95 backdrop-blur-sm px-4 py-4 sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          <ChatInput
            onSubmit={onSendMessage}
            selectedModelId={selectedModelId}
            onModelChange={onModelChange}
            availableModels={availableModels}
          />
        </div>
      </div>
    </div>
  );
}
