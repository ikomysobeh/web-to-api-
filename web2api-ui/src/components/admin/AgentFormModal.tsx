import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminStore } from "@/stores/adminStore";
import type { Agent, AgentCreate, AgentUpdate } from "@/types/chat";

interface AgentFormModalProps {
  agent: Agent | null;
  onClose: () => void;
  onCreated?: (agent: Agent) => void;
}

const INPUT_CLS =
  "w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500/60";

export function AgentFormModal({ agent, onClose, onCreated }: AgentFormModalProps) {
  const { createAgent, updateAgent, isSaving } = useAdminStore();

  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [model, setModel] = useState(agent?.model ?? "gemini-3-flash");
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [isActive, setIsActive] = useState(agent?.is_active ?? true);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Name is required"); return; }
    if (!instructions.trim()) { setError("Instructions are required"); return; }

    try {
      if (agent) {
        const data: AgentUpdate = { name, description, model, instructions, is_active: isActive };
        await updateAgent(agent.id, data);
        onClose();
      } else {
        const data: AgentCreate = { name, description, model, instructions };
        const newAgent = await createAgent(data);
        onClose();
        onCreated?.(newAgent);
      }
    } catch {
      setError("Something went wrong. Please try again.");
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
        aria-labelledby="agent-form-title"
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2",
          "rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl shadow-black/60",
        )}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="agent-form-title" className="text-sm font-semibold text-zinc-100">
            {agent ? "Edit agent" : "Create agent"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <Field label="Name" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My assistant"
              className={INPUT_CLS}
            />
          </Field>

          <Field label="Description">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this agent do?"
              className={INPUT_CLS}
            />
          </Field>

          <Field label="Model">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gemini-3-flash"
              className={INPUT_CLS}
            />
          </Field>

          <Field label="Instructions" required>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="You are a helpful assistant…"
              rows={5}
              className={cn(INPUT_CLS, "resize-none")}
            />
          </Field>

          {agent && (
            <div className="flex items-center justify-between rounded-xl bg-zinc-800/40 px-4 py-3">
              <span className="text-sm text-zinc-300">Active</span>
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  isActive ? "bg-violet-600" : "bg-zinc-700",
                )}
              >
                <span
                  className={cn(
                    "inline-block size-4 rounded-full bg-white shadow-sm transition-transform",
                    isActive ? "translate-x-4" : "translate-x-0",
                  )}
                />
              </button>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
            >
              {isSaving ? "Saving…" : agent ? "Save changes" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-400">
        {label}
        {required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}
