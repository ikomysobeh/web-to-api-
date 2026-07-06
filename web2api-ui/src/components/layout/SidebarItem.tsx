import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface SidebarItemProps {
  id: string;
  title: string;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
}

export function SidebarItem({
  title,
  active,
  onClick,
  onDelete,
  onRename,
}: SidebarItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) setEditValue(title);
  }, [title, isEditing]);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setEditValue(title);
    setIsEditing(true);
  }

  function saveEdit() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) onRename(trimmed);
    setIsEditing(false);
  }

  function cancelEdit() {
    setEditValue(title);
    setIsEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
  }

  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleDelete(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setConfirmOpen(true);
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────
  if (isEditing) {
    return (
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1 overflow-hidden rounded-xl bg-zinc-800/70 px-3 py-2 ring-1 ring-orange-500/40">
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={saveEdit}
          className="min-w-0 bg-transparent text-sm text-zinc-100 focus:outline-none"
          maxLength={80}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); saveEdit(); }}
            aria-label="Save"
            className="flex size-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-emerald-400"
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); cancelEdit(); }}
            aria-label="Cancel"
            className="flex size-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-red-400"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // ── Normal mode ───────────────────────────────────────────────────────────
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
      }}
      className={cn(
        "group relative grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 overflow-hidden rounded-xl py-2 pl-3 pr-1.5 text-sm transition-colors duration-100",
        active
          ? "bg-gradient-to-r from-orange-600/20 to-amber-600/5 text-white ring-1 ring-inset ring-orange-500/15"
          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
      )}
    >
      {/* Violet accent bar when active */}
      {active && (
        <span className="pointer-events-none absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-orange-400 to-amber-400" />
      )}

      <span className="min-w-0 truncate leading-snug" title={title}>
        {title}
      </span>

      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5 transition-opacity duration-100",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <button
          type="button"
          aria-label={`Rename: ${title}`}
          onClick={startEdit}
          className="flex size-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          aria-label={`Delete: ${title}`}
          onClick={handleDelete}
          className="flex size-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-red-400"
        >
          <Trash2 className="size-3" />
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete conversation"
        description={`"${title}" will be permanently deleted.`}
        onConfirm={() => { setConfirmOpen(false); onDelete(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
