import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Pencil, Sparkles, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/context/AuthContext";

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
          <p key={bi} className="leading-relaxed">
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
  userInitials,
  onDelete,
  onSendMessage,
}: {
  message: ChatMessage;
  userInitials: string;
  onDelete: () => void;
  onSendMessage: (content: string) => void;
}) {
  const isUser = message.role === "user";
  const isSending = message.status === "sending";
  const isDone = message.status === "done" || message.status === "error";

  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);

  function handleCopy() {
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleSaveEdit() {
    const trimmed = editValue.trim();
    if (trimmed) onSendMessage(trimmed);
    setEditing(false);
  }

  return (
    <div
      className={cn(
        "group flex w-full gap-3",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {isUser ? (
        <Avatar className="mt-0.5 size-7 shrink-0 shadow-md shadow-violet-950/40">
          <AvatarFallback className="bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xs font-semibold text-white">
            {userInitials}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/25 to-fuchsia-500/25 ring-1 ring-inset ring-white/10">
          <Sparkles className="size-3.5 text-violet-300" />
        </div>
      )}

      <div
        className={cn(
          "flex max-w-[78%] flex-col gap-1.5",
          isUser ? "items-end" : "items-start",
        )}
      >
        {/* Bubble */}
        <div
          className={cn(
            "px-4 py-3 text-sm",
            isUser
              ? "rounded-3xl rounded-tr-sm bg-white/[0.06] text-zinc-100 ring-1 ring-inset ring-white/10 backdrop-blur-sm"
              : "text-zinc-300",
            isSending && "animate-pulse opacity-60",
          )}
        >
          {isSending ? (
            <div className="flex items-center gap-1.5 py-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 animate-bounce rounded-full bg-zinc-500"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          ) : editing ? (
            <div className="flex min-w-[220px] flex-col gap-2">
              <textarea
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSaveEdit();
                  }
                  if (e.key === "Escape") setEditing(false);
                }}
                className="min-h-[60px] w-full resize-none rounded-xl bg-white/5 px-3 py-2 text-sm text-zinc-100 ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-violet-400/50"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-lg px-3 py-1 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 px-3 py-1 text-xs font-semibold text-white shadow-md shadow-violet-950/50 transition-all hover:shadow-violet-900/60 active:scale-95"
                >
                  Send
                </button>
              </div>
            </div>
          ) : (
            <MessageContent content={message.content} />
          )}
        </div>

        {/* Actions row */}
        <div
          className={cn(
            "flex items-center gap-1 px-1",
            isUser ? "flex-row-reverse" : "flex-row",
          )}
        >
          <time
            dateTime={message.createdAt.toISOString()}
            className="text-xs text-zinc-600"
          >
            {formatTime(message.createdAt)}
          </time>

          {isDone && (
            <div
              className={cn(
                "flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100",
                isUser ? "flex-row-reverse" : "flex-row",
              )}
            >
              <button
                type="button"
                aria-label="Copy message"
                onClick={handleCopy}
                className="flex size-6 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-white/10 hover:text-zinc-300"
              >
                {copied ? (
                  <Check className="size-3 text-violet-400" />
                ) : (
                  <Copy className="size-3" />
                )}
              </button>

              {isUser && !editing && (
                <button
                  type="button"
                  aria-label="Edit message"
                  onClick={() => {
                    setEditValue(message.content);
                    setEditing(true);
                  }}
                  className="flex size-6 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-white/10 hover:text-zinc-300"
                >
                  <Pencil className="size-3" />
                </button>
              )}

              <button
                type="button"
                aria-label="Delete message"
                onClick={onDelete}
                className="flex size-6 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-white/10 hover:text-red-400"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
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
  myAgents,
  selectedAgentId,
  onAgentChange,
}: ChatMessagesProps) {
  const { user } = useAuth();
  const userInitials = user?.email
    ? user.email.split("@")[0].slice(0, 2).toUpperCase()
    : "U";

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const lastMsgIdRef = useRef<string>("");
  const [confirmMsgId, setConfirmMsgId] = useState<string | null>(null);

  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }

  useEffect(() => {
    const msgs = session.messages;
    if (!msgs.length) return;
    const last = msgs[msgs.length - 1];

    // Only react when a brand-new message appears — not on every streaming chunk
    if (last.id === lastMsgIdRef.current) return;
    lastMsgIdRef.current = last.id;

    if (last.role === "user" || isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [session.messages]);

  const isEmpty = session.messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 pb-8 pt-6 sm:px-6">

          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-zinc-400 backdrop-blur-sm transition-colors hover:bg-white/10 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : null}
                {isLoadingMore ? "Loading…" : "Load older messages"}
              </button>
            </div>
          )}

          <ConfirmDialog
            open={confirmMsgId !== null}
            title="Delete message"
            description="This message will be permanently deleted."
            onConfirm={() => {
              onDeleteMessage(confirmMsgId!);
              setConfirmMsgId(null);
            }}
            onCancel={() => setConfirmMsgId(null)}
          />

          {isEmpty ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 py-24 text-center">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/25 ring-1 ring-inset ring-white/10">
                <Sparkles className="size-5 text-violet-300" />
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
                userInitials={userInitials}
                onDelete={() => setConfirmMsgId(msg.id)}
                onSendMessage={onSendMessage}
              />
            ))
          )}

          <div ref={bottomRef} className="h-1" />
        </div>
      </div>

      <div className="glass-nav shrink-0 border-t border-white/5 px-4 py-4 sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          <ChatInput
            onSubmit={onSendMessage}
            selectedModelId={selectedModelId}
            onModelChange={onModelChange}
            availableModels={availableModels}
            myAgents={myAgents}
            selectedAgentId={selectedAgentId}
            onAgentChange={onAgentChange}
          />
        </div>
      </div>
    </div>
  );
}
