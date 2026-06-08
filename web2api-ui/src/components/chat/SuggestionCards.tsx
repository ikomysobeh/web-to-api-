import {
  Bug,
  Code2,
  FileText,
  GraduationCap,
  Lightbulb,
  PenLine,
  type LucideIcon,
} from "lucide-react";

import type { SuggestionPrompt } from "@/types/chat";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Icon registry — maps the string names stored in mock data to components
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  Code2,
  Lightbulb,
  FileText,
  GraduationCap,
  PenLine,
  Bug,
};

// ---------------------------------------------------------------------------
// Single card
// ---------------------------------------------------------------------------

interface SuggestionCardProps {
  prompt: SuggestionPrompt;
  onClick: (prompt: string) => void;
}

function SuggestionCard({ prompt, onClick }: SuggestionCardProps) {
  const Icon = ICON_MAP[prompt.icon] ?? Lightbulb;

  return (
    <button
      type="button"
      onClick={() => onClick(prompt.prompt)}
      className={cn(
        // Layout
        "group flex flex-col items-start gap-2 rounded-[28px] p-4 text-left",
        // Background / border
        "bg-zinc-900/60 ring-1 ring-zinc-800/50 backdrop-blur-sm",
        // Hover
        "hover:bg-zinc-900/80 hover:ring-zinc-700/40",
        // Transition
        "transition-all duration-200",
        // Full width inside the grid
        "w-full",
      )}
    >
      {/* Icon chip */}
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-xl",
          "bg-zinc-800 text-zinc-400",
          "group-hover:bg-violet-600/15 group-hover:text-violet-300",
          "transition-colors duration-200",
        )}
      >
        <Icon className="size-4" />
      </span>

      {/* Title */}
      <span className="text-sm font-medium text-zinc-200 leading-snug">
        {prompt.title}
      </span>

      {/* Prompt preview — 2 lines max */}
      <span className="line-clamp-2 text-xs text-zinc-500 leading-relaxed">
        {prompt.prompt}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

interface SuggestionCardsProps {
  prompts: SuggestionPrompt[];
  /** Fires with the full prompt string when a card is clicked */
  onSelect: (prompt: string) => void;
}

export function SuggestionCards({ prompts, onSelect }: SuggestionCardsProps) {
  return (
    <div
      className={cn(
        "grid w-full gap-3",
        // 1 col on smallest, 2 cols from sm, 3 cols from md
        "grid-cols-1 sm:grid-cols-2 md:grid-cols-3",
      )}
    >
      {prompts.map((p) => (
        <SuggestionCard key={p.id} prompt={p} onClick={onSelect} />
      ))}
    </div>
  );
}
