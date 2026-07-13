import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Pencil, Sparkles, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/context/AuthContext";

import type { ChatMessage } from "@/types/chat";
import type { ChatMessagesProps } from "@/app/AppShell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ChatInput } from "./ChatInput";
import { MarkdownMessage } from "./MarkdownMessage";

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MessageBubble({
  message,
  userInitials,
  isLast,
  onDelete,
  onSendMessage,
}: {
  message: ChatMessage;
  userInitials: string;
  isLast: boolean;
  onDelete: () => void;
  onSendMessage: (content: string) => void;
}) {
  const isUser = message.role === "user";
  const isSending = message.status === "sending";
  const isDone = message.status === "done" || message.status === "error";
  // Assistant reply placeholder that hasn't received its first streamed token
  // yet — show a typing indicator so the user knows a response is on its way.
  const isWaiting =
    !isUser && message.status === "streaming" && message.content === "";

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
        "group flex w-full min-w-0 gap-3",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {isUser ? (
        <Avatar className="mt-0.5 size-7 shrink-0 shadow-md shadow-orange-950/40">
          <AvatarFallback className="bg-gradient-to-br from-orange-500 to-amber-500 text-xs font-semibold text-white">
            {userInitials}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500/25 to-amber-500/25 ring-1 ring-inset ring-white/10">
          <Sparkles className="size-3.5 text-orange-300" />
        </div>
      )}

      <div
        className={cn(
          "flex min-w-0 max-w-[78%] flex-col gap-1.5",
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
          {isSending || isWaiting ? (
            <div
              className="flex items-center gap-1.5 py-0.5"
              role="status"
              aria-label={isWaiting ? "Assistant is typing" : "Sending message"}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 animate-bounce rounded-full bg-orange-400/70"
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
                className="min-h-[60px] w-full resize-none rounded-xl bg-white/5 px-3 py-2 text-sm text-zinc-100 ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-orange-400/50"
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
                  className="rounded-lg bg-gradient-to-br from-orange-600 to-amber-600 px-3 py-1 text-xs font-semibold text-white shadow-md shadow-orange-950/50 transition-all hover:shadow-orange-900/60 active:scale-95"
                >
                  Send
                </button>
              </div>
            </div>
          ) : (
            <MarkdownMessage content={message.content} />
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
                  <Check className="size-3 text-orange-400" />
                ) : (
                  <Copy className="size-3" />
                )}
              </button>

              {isUser && isLast && !editing && (
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
  agentLocked,
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

    // A just-sent turn always ends with an empty streaming assistant placeholder
    // (the user's message + the reply are appended together). Force-scroll to it
    // so the typing indicator is visible even if the user had scrolled up while
    // reading an earlier reply.
    const isPendingReply =
      last.role === "assistant" &&
      last.status === "streaming" &&
      last.content === "";

    if (last.role === "user" || isPendingReply || isAtBottomRef.current) {
      isAtBottomRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [session.messages]);

  const isEmpty = session.messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-8 px-4 pb-8 pt-6 sm:px-6">

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
              <div className="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500/25 to-amber-500/25 ring-1 ring-inset ring-white/10">
                <Sparkles className="size-5 text-orange-300" />
              </div>
              <p className="text-sm text-zinc-500">
                No messages yet. Start the conversation below.
              </p>
            </div>
          ) : (
            (() => {
              // Index of the most recent USER message — the only one that stays editable.
              let lastUserIndex = -1;
              for (let i = session.messages.length - 1; i >= 0; i--) {
                if (session.messages[i].role === "user") {
                  lastUserIndex = i;
                  break;
                }
              }
              return session.messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  userInitials={userInitials}
                  isLast={i === lastUserIndex}
                  onDelete={() => setConfirmMsgId(msg.id)}
                  onSendMessage={onSendMessage}
                />
              ));
            })()
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
            agentLocked={agentLocked}
          />
        </div>
      </div>
    </div>
  );
}
