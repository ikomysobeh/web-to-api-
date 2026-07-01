import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";
import { useAdminStore } from "@/stores/adminStore";
import { useEmbedStore } from "@/stores/embedStore";
import type { EmbedConfig } from "@/types/chat";

interface EmbedFormModalProps {
  embed: EmbedConfig | null;
  onClose: () => void;
  onCreated?: (embed: EmbedConfig) => void;
}

const INPUT_CLS =
  "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-violet-400/40 focus:outline-none focus:ring-1 focus:ring-violet-400/50";

export function EmbedFormModal({ embed, onClose, onCreated }: EmbedFormModalProps) {
  const { agents, loadAgents } = useAdminStore();
  const { createEmbed, updateEmbed, isSaving } = useEmbedStore();

  const [agentId, setAgentId] = useState(embed?.agent_id ?? "");
  const [title, setTitle] = useState(embed?.config?.title ?? "Lumina Assistant");
  const [greeting, setGreeting] = useState(embed?.config?.greeting ?? "Hi! How can I help you today?");
  const [accentColor, setAccentColor] = useState(embed?.config?.accentColor ?? "#7c3aed");
  const [position, setPosition] = useState<"bottom-right" | "bottom-left">(
    embed?.config?.position ?? "bottom-right",
  );
  const [theme, setTheme] = useState<"dark" | "light">(embed?.config?.theme ?? "dark");
  const [domains, setDomains] = useState(embed?.allowed_domains?.join(", ") ?? "");
  const [isActive, setIsActive] = useState(embed?.is_active ?? true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (agents.length === 0) void loadAgents();
  }, [agents.length, loadAgents]);

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
    if (!embed && !agentId) {
      setError("Pick an agent");
      return;
    }

    const allowed_domains = domains
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    const config = { title, greeting, accentColor, position, theme };

    try {
      if (embed) {
        await updateEmbed(embed.id, { allowed_domains, config, is_active: isActive });
        onClose();
      } else {
        const created = await createEmbed({ agent_id: agentId, allowed_domains, config });
        onClose();
        onCreated?.(created);
      }
    } catch (err) {
      setError(await getErrorMessage(err));
    }
  }

  const activeAgents = agents.filter((a) => a.is_active);

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />

      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "glass-strong fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col",
          "rounded-2xl p-6",
        )}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">
            {embed ? "Edit widget" : "Create widget"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 overflow-y-auto">
          {!embed && (
            <Field label="Agent" required>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className={INPUT_CLS}
              >
                <option value="">Select an agent…</option>
                {activeAgents.map((a) => (
                  <option key={a.id} value={a.id} className="bg-zinc-900">
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Widget title">
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT_CLS} />
          </Field>

          <Field label="Greeting message">
            <input type="text" value={greeting} onChange={(e) => setGreeting(e.target.value)} className={INPUT_CLS} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Accent color">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="size-9 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent"
                />
                <input type="text" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className={INPUT_CLS} />
              </div>
            </Field>

            <Field label="Theme">
              <select value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")} className={INPUT_CLS}>
                <option value="dark" className="bg-zinc-900">Dark</option>
                <option value="light" className="bg-zinc-900">Light</option>
              </select>
            </Field>
          </div>

          <Field label="Bubble position">
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as "bottom-right" | "bottom-left")}
              className={INPUT_CLS}
            >
              <option value="bottom-right" className="bg-zinc-900">Bottom right</option>
              <option value="bottom-left" className="bg-zinc-900">Bottom left</option>
            </select>
          </Field>

          <Field label="Allowed domains (comma-separated, blank = any)">
            <input
              type="text"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="example.com, dashboard.acme.com"
              className={INPUT_CLS}
            />
          </Field>

          {embed && (
            <div className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 ring-1 ring-inset ring-white/5">
              <span className="text-sm text-zinc-300">Active</span>
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  isActive ? "bg-gradient-to-r from-violet-500 to-fuchsia-500" : "bg-zinc-700",
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
              className="rounded-xl px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-violet-950/50 transition-all hover:shadow-violet-900/60 active:scale-[0.98] disabled:opacity-50"
            >
              {isSaving ? "Saving…" : embed ? "Save changes" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
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
