import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Code2,
  Copy,
  Check,
  Pencil,
  Plus,
  PowerOff,
  Globe,
  Eye,
  ExternalLink,
  KeyRound,
  MessageCircle,
} from "lucide-react";
import { useEmbedStore } from "@/stores/embedStore";
import { EmbedFormModal } from "./EmbedFormModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { gradientFor, initialsOf } from "@/lib/gradients";
import { cn } from "@/lib/utils";
import type { EmbedConfig } from "@/types/chat";

const WIDGET_BASE =
  (import.meta.env.VITE_WIDGET_URL as string | undefined)?.replace(/\/$/, "") ??
  window.location.origin;

function snippetFor(key: string): string {
  return `<script src="${WIDGET_BASE}/embed.js" data-embed="${key}" data-token-key="auth_token" async></script>`;
}

// Tiny hand-rolled tokenizer — good enough for a one-line <script> tag and
// avoids pulling a syntax highlighter for a single string of markup.
const CODE_TOKEN_RE = /("[^"]*")|(<\/?)|(\/?>)|(=)|([\w-]+)/g;

function highlightSnippet(code: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let match: RegExpExecArray | null;
  let key = 0;
  CODE_TOKEN_RE.lastIndex = 0;
  while ((match = CODE_TOKEN_RE.exec(code))) {
    const [full, str, open, close, eq, word] = match;
    let className = "text-zinc-400";
    if (str) className = "text-emerald-300";
    else if (open || close || eq) className = "text-zinc-500";
    else if (word === "async") className = "text-amber-300";
    else if (word === "script") className = "text-orange-400";
    else if (word) className = "text-orange-300";
    nodes.push(
      <span key={key++} className={className}>
        {full}
      </span>,
    );
  }
  return nodes;
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        active
          ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
          : "bg-white/5 text-zinc-500 ring-white/10",
      )}
    >
      <span className={cn("size-1.5 rounded-full", active ? "bg-emerald-400" : "bg-zinc-500")} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function MetaChip({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-zinc-400 ring-1 ring-inset ring-white/5">
      <Icon className="size-3" />
      {label}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-1.5 px-3.5 py-3 text-sm font-medium transition-colors",
        active ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
      )}
    >
      <Icon className="size-4" />
      {label}
      {active && (
        <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-orange-400 to-amber-400" />
      )}
    </button>
  );
}

function StepItem({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-[11px] font-semibold text-orange-300 ring-1 ring-inset ring-orange-400/20">
        {n}
      </span>
      <p className="text-sm leading-relaxed text-zinc-400">{children}</p>
    </li>
  );
}

export function EmbedPage() {
  const { embeds, isLoading, loadEmbeds, deleteEmbed } = useEmbedStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editEmbed, setEditEmbed] = useState<EmbedConfig | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"install" | "preview">("install");
  const [copied, setCopied] = useState(false);
  const previewRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    void loadEmbeds();
  }, [loadEmbeds]);

  // Default to the first widget so the install panel is never empty, without
  // needing an effect just to seed local state from a derived value.
  const effectiveId = selectedId ?? embeds[0]?.id ?? null;
  const selected = embeds.find((e) => e.id === effectiveId) ?? null;

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
        <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-orange-500" />
      </div>
    );
  }

  return (
    <div>
      {/* Header band */}
      <div className="flex items-center justify-between gap-4 border-b border-white/5 px-6 py-6 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/5 text-orange-300">
            <Code2 className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Embed Widgets</h2>
            <p className="text-xs text-zinc-500">
              {embeds.length} {embeds.length === 1 ? "widget" : "widgets"} · visitors reuse your dashboard's
              sign-in automatically
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-orange-600 to-amber-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:from-orange-500 hover:to-amber-500 active:scale-[0.98]"
        >
          <Plus className="size-4" />
          Create widget
        </button>
      </div>

      {embeds.length === 0 ? (
        <div className="flex h-72 flex-col items-center justify-center gap-3 px-6">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 text-orange-300 ring-1 ring-inset ring-orange-400/20">
            <Code2 className="size-6" />
          </div>
          <p className="text-sm font-medium text-zinc-300">No widgets yet</p>
          <p className="max-w-xs text-center text-xs text-zinc-500">
            Create a widget, then paste one script tag into any dashboard to bring your agent along.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-1 text-sm font-medium text-orange-300 transition-colors hover:text-orange-200"
          >
            Create your first widget
          </button>
        </div>
      ) : (
        <div className="grid items-start gap-6 px-6 py-6 sm:px-8 lg:grid-cols-[380px_1fr]">
          {/* List */}
          <ul className="space-y-2">
            {embeds.map((embed) => {
              const isSelected = embed.id === effectiveId;
              const accent = embed.config?.accentColor || "#f97316";
              return (
                <li
                  key={embed.id}
                  className={cn(
                    "group rounded-2xl border p-3 transition-all",
                    isSelected
                      ? "border-white/15 bg-white/[0.05] shadow-lg shadow-black/20"
                      : "border-white/5 bg-white/[0.015] hover:border-white/10 hover:bg-white/[0.03]",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(embed.id);
                        setTab("install");
                      }}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <div className="relative shrink-0">
                        <div
                          className={cn(
                            "flex size-9 items-center justify-center rounded-lg bg-gradient-to-br text-xs font-bold text-white",
                            gradientFor(embed.agent_id),
                          )}
                        >
                          {initialsOf(embed.agent_name || "W")}
                        </div>
                        <span
                          className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-[#0c0b13]"
                          style={{ backgroundColor: accent }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-100">
                          {embed.config?.title || embed.agent_name || "Widget"}
                        </p>
                        <p className="truncate text-xs text-zinc-500">{embed.agent_name}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <MetaChip
                            icon={Globe}
                            label={
                              embed.allowed_domains.length > 0
                                ? `${embed.allowed_domains.length} domain${embed.allowed_domains.length === 1 ? "" : "s"}`
                                : "Any domain"
                            }
                          />
                        </div>
                      </div>
                    </button>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <StatusBadge active={embed.is_active} />
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(embed)}
                          aria-label="Edit widget"
                          className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-orange-500/20 hover:text-orange-300"
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
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Detail panel */}
          <div className="min-w-0 lg:sticky lg:top-6">
            {selected ? (
              <div className="glass-strong overflow-hidden rounded-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-xs font-bold text-white",
                        gradientFor(selected.agent_id),
                      )}
                    >
                      {initialsOf(selected.agent_name || "W")}
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-zinc-100">
                        {selected.config?.title || selected.agent_name || "Widget"}
                      </h3>
                      <p className="truncate text-xs text-zinc-500">
                        Powered by {selected.agent_name} ·{" "}
                        <span className="font-mono">{selected.embed_key}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge active={selected.is_active} />
                    <button
                      type="button"
                      onClick={() => openEdit(selected)}
                      aria-label="Edit widget"
                      className="flex size-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-orange-500/20 hover:text-orange-300"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-1 border-b border-white/5 px-4">
                  <TabButton active={tab === "install"} onClick={() => setTab("install")} icon={Code2} label="Install" />
                  <TabButton active={tab === "preview"} onClick={() => setTab("preview")} icon={Eye} label="Live preview" />
                </div>

                <div className="p-5">
                  {tab === "install" ? (
                    <div>
                      <ol className="mb-5 space-y-3">
                        <StepItem n={1}>Copy the snippet below.</StepItem>
                        <StepItem n={2}>
                          Paste it just before the closing{" "}
                          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs text-zinc-300">
                            &lt;/body&gt;
                          </code>{" "}
                          tag on your dashboard.
                        </StepItem>
                        <StepItem n={3}>
                          Done — your dashboard and this app share one sign-in, so the widget recognizes the
                          visitor instantly. No API keys, no redirects.
                        </StepItem>
                      </ol>

                      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b0a10]">
                        <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-3.5 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="size-2.5 rounded-full bg-red-500/70" />
                            <span className="size-2.5 rounded-full bg-amber-500/70" />
                            <span className="size-2.5 rounded-full bg-emerald-500/70" />
                            <span className="ml-2 font-mono text-[11px] text-zinc-500">dashboard.html</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => void copySnippet(selected.embed_key)}
                            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
                          >
                            {copied ? (
                              <>
                                <Check className="size-3.5 text-emerald-400" />
                                <span className="text-emerald-400">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="size-3.5" />
                                Copy
                              </>
                            )}
                          </button>
                        </div>
                        <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[13px] leading-relaxed">
                          <code>{highlightSnippet(snippetFor(selected.embed_key))}</code>
                        </pre>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <MetaChip
                          icon={Globe}
                          label={
                            selected.allowed_domains.length > 0
                              ? selected.allowed_domains.join(", ")
                              : "Works on any domain"
                          }
                        />
                        <MetaChip icon={KeyRound} label="Shared auth_token · zero extra config" />
                      </div>

                      <p className="mt-3 text-xs text-zinc-500">
                        Storing the token under a different key? Swap{" "}
                        <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[11px] text-zinc-400">
                          data-token-key
                        </code>{" "}
                        in the snippet above.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/40">
                        <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.03] px-3 py-2">
                          <span className="size-2.5 rounded-full bg-red-500/70" />
                          <span className="size-2.5 rounded-full bg-amber-500/70" />
                          <span className="size-2.5 rounded-full bg-emerald-500/70" />
                          <div className="ml-2 flex-1 truncate rounded-md bg-white/5 px-2.5 py-1 text-center font-mono text-[10px] text-zinc-500">
                            yourdashboard.com
                          </div>
                        </div>
                        <iframe
                          ref={previewRef}
                          title="Widget preview"
                          src={`${WIDGET_BASE}/widget?embed=${selected.embed_key}`}
                          className="h-[460px] w-full bg-zinc-950"
                        />
                      </div>
                      <a
                        href={`${WIDGET_BASE}/widget?embed=${selected.embed_key}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-orange-300 transition-colors hover:text-orange-200"
                      >
                        <ExternalLink className="size-3.5" />
                        Open full preview in a new tab
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10">
                <MessageCircle className="size-6 text-zinc-600" />
                <p className="text-sm text-zinc-500">Select a widget to see its install code</p>
              </div>
            )}
          </div>
        </div>
      )}

      {formOpen && (
        <EmbedFormModal
          embed={editEmbed}
          onClose={() => setFormOpen(false)}
          onCreated={(embed) => setSelectedId(embed.id)}
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
