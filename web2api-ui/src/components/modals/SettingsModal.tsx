import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { getUserProfile, updateUserProfile } from "@/services/api";
import { useConversationStore } from "@/stores/conversationStore";
import { cn } from "@/lib/utils";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { availableModels, setSelectedModelId } = useConversationStore();
  const token = localStorage.getItem("auth_token") ?? "";

  const [email, setEmail] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const modelMenuRef = useRef<HTMLDivElement>(null);

  // Load profile on open
  useEffect(() => {
    getUserProfile(token)
      .then(({ user }) => {
        setEmail(user.email);
        setCreatedAt(
          new Date(user.created_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
        );
        setDefaultModel(user.preferences.default_model);
        setTheme(user.preferences.theme);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [token]);

  // Close model dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!modelMenuRef.current?.contains(e.target as Node)) setModelMenuOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);

  async function handleSave() {
    setIsSaving(true);
    setSaveMsg(null);
    try {
      await updateUserProfile(token, { default_model: defaultModel, theme });
      setSelectedModelId(defaultModel);
      setSaveMsg("Saved!");
      setTimeout(() => setSaveMsg(null), 2000);
    } catch {
      setSaveMsg("Failed to save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const selectedModelName =
    availableModels.find((m) => m.id === defaultModel)?.name ?? defaultModel;

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="fixed inset-x-4 top-[10vh] z-50 mx-auto max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/70 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="size-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-zinc-500" />
          </div>
        ) : (
          <div className="px-5 py-5 space-y-6">

            {/* ── Account section ────────────────────────────────────────── */}
            <section>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Account
              </p>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between rounded-xl bg-zinc-900/60 px-4 py-3">
                  <span className="text-xs text-zinc-500">Email</span>
                  <span className="text-sm text-zinc-200">{email}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-zinc-900/60 px-4 py-3">
                  <span className="text-xs text-zinc-500">Member since</span>
                  <span className="text-sm text-zinc-200">{createdAt}</span>
                </div>
              </div>
            </section>

            {/* ── Preferences section ─────────────────────────────────────── */}
            <section>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Preferences
              </p>
              <div className="space-y-3">

                {/* Default model */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-zinc-200">Default model</p>
                    <p className="text-xs text-zinc-500">Used for new conversations</p>
                  </div>

                  <div ref={modelMenuRef} className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setModelMenuOpen((v) => !v)}
                      disabled={availableModels.length === 0}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-50"
                    >
                      <span className="max-w-32 truncate">{selectedModelName || "Select…"}</span>
                      <ChevronDown className="size-3.5 text-zinc-400" />
                    </button>

                    {modelMenuOpen && (
                      <div className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 py-1 shadow-2xl">
                        {availableModels.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            disabled={!m.available}
                            onClick={() => {
                              if (m.available) {
                                setDefaultModel(m.id);
                                setModelMenuOpen(false);
                              }
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                              m.available
                                ? "hover:bg-zinc-800"
                                : "cursor-not-allowed opacity-40",
                            )}
                          >
                            <span className="flex size-4 items-center justify-center">
                              {m.id === defaultModel && (
                                <Check className="size-3.5 text-violet-400" />
                              )}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-zinc-200">{m.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Theme */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-zinc-200">Theme</p>
                    <p className="text-xs text-zinc-500">Interface color scheme</p>
                  </div>
                  <div className="flex gap-1.5">
                    {(["dark", "light"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTheme(t)}
                        className={cn(
                          "rounded-xl px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                          theme === t
                            ? "bg-violet-600 text-white"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200",
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* ── Save ───────────────────────────────────────────────────── */}
            <div className="flex items-center justify-end gap-3 border-t border-zinc-800/50 pt-4">
              {saveMsg && (
                <span
                  className={cn(
                    "text-xs",
                    saveMsg === "Saved!" ? "text-emerald-400" : "text-red-400",
                  )}
                >
                  {saveMsg}
                </span>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
              >
                {isSaving && <Loader2 className="size-3.5 animate-spin" />}
                Save changes
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
