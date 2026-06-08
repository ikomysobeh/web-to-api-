import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarItemProps {
  id: string;
  title: string;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}

export function SidebarItem({
  title,
  active,
  onClick,
  onDelete,
}: SidebarItemProps) {
  function handleDelete(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    onDelete();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-hidden rounded-xl py-2 pl-3 pr-3 text-sm transition-colors",
        active
          ? "bg-zinc-800/60 text-white"
          : "text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
      )}
    >
      <span className="min-w-0 truncate leading-snug" title={title}>
        {title}
      </span>

      <button
        type="button"
        aria-label={`Delete chat: ${title}`}
        onClick={handleDelete}
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-lg bg-transparent text-zinc-400 transition-colors",
          "hover:bg-zinc-700 hover:text-red-400",
          active && "text-white"
        )}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}