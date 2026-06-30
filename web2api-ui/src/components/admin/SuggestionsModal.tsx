import { useEffect, useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminStore } from "@/stores/adminStore";

interface SuggestionsModalProps {
  agentId: string;
  agentName: string;
  initialQuestions: string[];
  onClose: () => void;
}

const INPUT_CLS =
  "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-violet-400/40 focus:outline-none focus:ring-1 focus:ring-violet-400/50";

export function SuggestionsModal({ agentId, agentName, initialQuestions, onClose }: SuggestionsModalProps) {
  const { saveSuggestions, isSavingSuggestions } = useAdminStore();

  const [questions, setQuestions] = useState<string[]>(
    initialQuestions.length > 0 ? initialQuestions : [""],
  );
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function updateAt(index: number, value: string) {
    setQuestions((qs) => qs.map((q, i) => (i === index ? value : q)));
  }

  function removeAt(index: number) {
    setQuestions((qs) => qs.filter((_, i) => i !== index));
  }

  function addRow() {
    setQuestions((qs) => [...qs, ""]);
  }

  async function handleSave() {
    setError("");
    const cleaned = questions.map((q) => q.trim()).filter(Boolean);
    try {
      await saveSuggestions(agentId, cleaned);
      onClose();
    } catch {
      setError("Could not save suggestions. Please try again.");
    }
  }

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="suggestions-title"
        className={cn(
          "glass-strong fixed left-1/2 top-1/2 z-50 flex w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col",
          "max-h-[85vh] rounded-2xl p-6",
        )}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 id="suggestions-title" className="text-sm font-semibold text-zinc-100">
            Suggested questions
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          Review the questions for <span className="text-zinc-300">{agentName}</span>. Edit, delete, or add
          your own, then approve to show them to users of this agent.
        </p>

        <div className="-mx-1 flex-1 space-y-2 overflow-y-auto px-1">
          {questions.length === 0 && (
            <p className="rounded-xl bg-white/5 px-4 py-3 text-sm text-zinc-400 ring-1 ring-inset ring-white/5">
              No questions. Add one below or cancel.
            </p>
          )}
          {questions.map((q, i) => (
            <div key={i} className="flex items-start gap-2">
              <input
                type="text"
                value={q}
                onChange={(e) => updateAt(i, e.target.value)}
                placeholder="Type a question…"
                className={INPUT_CLS}
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label="Delete question"
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addRow}
          className="mt-3 inline-flex items-center gap-1.5 self-start rounded-xl px-3 py-2 text-sm text-violet-300 transition-colors hover:bg-white/10"
        >
          <Plus className="size-4" />
          Add question
        </button>

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-4 flex items-center justify-end gap-3 border-t border-white/5 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSavingSuggestions}
            className="rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-violet-950/50 transition-all hover:shadow-violet-900/60 active:scale-[0.98] disabled:opacity-50"
          >
            {isSavingSuggestions ? "Saving…" : "Approve & Save"}
          </button>
        </div>
      </div>
    </>
  );
}
