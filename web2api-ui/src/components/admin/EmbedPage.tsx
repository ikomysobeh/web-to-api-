import { useEffect, useRef, useState } from "react";
import { Code2, Copy, Check, Pencil, Plus, PowerOff } from "lucide-react";
import { useEmbedStore } from "@/stores/embedStore";
import { EmbedFormModal } from "./EmbedFormModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import type { EmbedConfig } from "@/types/chat";

const WIDGET_BASE =
  (import.meta.env.VITE_WIDGET_URL as string | undefined)?.replace(/\/$/, "") ??
  window.location.origin;

function snippetFor(key: string): string {
  return `<script src="${WIDGET_BASE}/embed.js" data-embed="${key}" data-token-key="auth_token" async></script>`;
}

export function EmbedPage() {
  const { embeds, isLoading, loadEmbeds, deleteEmbed } = useEmbedStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editEmbed, setEditEmbed] = useState<EmbedConfig | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selected, setSelected] = useState<EmbedConfig | null>(null);
  const [copied, setCopied] = useState(false);
  const previewRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    void loadEmbeds();
  }, [loadEmbeds]);

  // Hand the admin's token to the preview iframe when it signals ready
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "ready" && previewRef.current?.contentWindow) {
        const token = localStorage.getItem("auth_token") ?? "";
        previewRef.current.contentWindow.postMessage(
          { type: "lumina-auth", token },
          WIDGET_BASE,
        );
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function openCreate() {
    setEditEmbed(null);
    setFormOpen(true);
  }
  function openEdit(embed: EmbedConfig) {
    setEditEmbed(embed);
    setFormOpen(true);
  }
  async function handleDelete() {
    if (!deleteId) return;
    await deleteEmbed(deleteId);
    if (selected?.id === deleteId) setSelected(null);
    setDeleteId(null);
  }
  async function copySnippet(key: string) {
    await navigator.clipboard.writeText(snippetFor(key));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
      </div>
    );
  }

  return (
    <div>
      {/* Header band */}
      <div className="flex items-center justify-between gap-4 border-b border-white/5 px-6 py-6 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/5 text-violet-300">
            <Code2 className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Embed Widgets</h2>
            <p className="text-xs text-zinc-500">
              {embeds.length} {embeds.length === 1 ? "widget" : "widgets"} · paste one line into any site
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:from-violet-500 hover:to-fuchsia-500 active:scale-[0.98]"
        >
          <Plus className="size-4" />
          Create widget
        </button>
      </div>

      <div className="grid gap-6 px-6 py-6 sm:px-8 lg:grid-cols-2">
        {/* List */}
        <div>
          {embeds.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10">
              <Code2 className="size-6 text-violet-300" />
              <p className="text-sm text-zinc-500">No widgets yet</p>
              <button
                type="button"
                onClick={openCreate}
                className="text-sm font-medium text-violet-300 transition-colors hover:text-violet-200"
              >
                Create your first widget
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/5">
              <ul className="divide-y divide-white/5">
                {embeds.map((embed) => (
                  <li
                    key={embed.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 transition-colors",
                      selected?.id === embed.id ? "bg-white/[0.04]" : "hover:bg-white/[0.02]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(embed)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-medium text-zinc-100">
                        {embed.config?.title || embed.agent_name || "Widget"}
                      </p>
                      <p className="truncate text-xs text-zinc-500">
                        {embed.agent_name} · <span className="font-mono">{embed.embed_key}</span>
                      </p>
                    </button>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                        embed.is_active
                          ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
                          : "bg-white/5 text-zinc-500 ring-white/10",
                      )}
                    >
                      {embed.is_active ? "Active" : "Inactive"}
                    </span>
                    <button
                      type="button"
                      onClick={() => openEdit(embed)}
                      aria-label="Edit widget"
                      className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-violet-500/20 hover:text-violet-300"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    {embed.is_active && (
                      <button
                        type="button"
                        onClick={() => setDeleteId(embed.id)}
                        aria-label="Deactivate widget"
                        className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-red-500/20 hover:text-red-300"
                      >
                        <PowerOff className="size-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Snippet + live preview */}
        {selected && (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Embed snippet
              </p>
              <div className="relative">
                <pre className="overflow-x-auto rounded-xl bg-white/[0.03] p-4 pr-12 font-mono text-xs leading-relaxed text-zinc-300 ring-1 ring-inset ring-white/5">
                  {snippetFor(selected.embed_key)}
                </pre>
                <button
                  type="button"
                  onClick={() => void copySnippet(selected.embed_key)}
                  aria-label="Copy snippet"
                  className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
                >
                  {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Paste this into any allowed site. The visitor must be logged in (token in
                <span className="font-mono"> auth_token</span>).
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Live preview
              </p>
              <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
                <iframe
                  ref={previewRef}
                  title="Widget preview"
                  src={`${WIDGET_BASE}/widget?embed=${selected.embed_key}`}
                  className="h-[480px] w-full"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {formOpen && (
        <EmbedFormModal
          embed={editEmbed}
          onClose={() => setFormOpen(false)}
          onCreated={(embed) => setSelected(embed)}
        />
      )}

      <ConfirmDialog
        open={deleteId !== null}
        title="Deactivate widget"
        description="This widget will stop working on all sites that use it."
        confirmLabel="Deactivate"
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
