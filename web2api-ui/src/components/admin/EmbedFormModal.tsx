import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, MessageCircle, X } from "lucide-react";
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
  const [domains, setDomains] = useState<string[]>(embed?.allowed_domains ?? []);
  const [domainDraft, setDomainDraft] = useState("");
  const [isActive, setIsActive] = useState(embed?.is_active ?? true);
  const [error, setError] = useState("");

  function addDomain(raw: string) {
    const value = raw.trim().replace(/,$/, "");
    if (value && !domains.includes(value)) setDomains((d) => [...d, value]);
    setDomainDraft("");
  }
  function removeDomain(value: string) {
    setDomains((d) => d.filter((x) => x !== value));
  }
  function handleDomainKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addDomain(domainDraft);
    } else if (e.key === "Backspace" && !domainDraft && domains.length > 0) {
      setDomains((d) => d.slice(0, -1));
    }
  }

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

    const allowed_domains = domainDraft.trim()
      ? [...domains, domainDraft.trim().replace(/,$/, "")]
      : domains;
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
          "glass-strong fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col",
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

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5 overflow-y-auto">
          <SectionLabel>Agent &amp; content</SectionLabel>

          {!embed && (
            <Field label="Agent" required>
              <ThemedSelect
                value={agentId}
                onChange={setAgentId}
                options={[
                  { value: "", label: "Select an agent…" },
                  ...activeAgents.map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </Field>
          )}

          <Field label="Widget title">
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT_CLS} />
          </Field>

          <Field label="Greeting message">
            <input type="text" value={greeting} onChange={(e) => setGreeting(e.target.value)} className={INPUT_CLS} />
          </Field>

          <SectionLabel>Appearance</SectionLabel>

          <div className="relative h-24 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent">
            <span className="absolute left-3 top-2.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              Preview
            </span>
            <div
              className={cn(
                "absolute flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-white shadow-lg",
                position === "bottom-right" ? "bottom-3 right-3" : "bottom-3 left-3",
              )}
              style={{ backgroundColor: accentColor }}
            >
              <MessageCircle className="size-3.5" />
              {title || "Chat"}
            </div>
          </div>

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
              <ThemedSelect
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                ]}
              />
            </Field>
          </div>

          <Field label="Bubble position">
            <ThemedSelect
              value={position}
              onChange={setPosition}
              options={[
                { value: "bottom-right", label: "Bottom right" },
                { value: "bottom-left", label: "Bottom left" },
              ]}
            />
          </Field>

          <SectionLabel>Access</SectionLabel>

          <Field label="Allowed domains" hint="Press Enter after each one · leave empty to allow any site">
            <div className={cn(INPUT_CLS, "flex flex-wrap items-center gap-1.5 py-1.5")}>
              {domains.map((d) => (
                <span
                  key={d}
                  className="flex items-center gap-1 rounded-md bg-violet-500/15 px-2 py-0.5 text-xs text-violet-200 ring-1 ring-inset ring-violet-400/20"
                >
                  {d}
                  <button
                    type="button"
                    onClick={() => removeDomain(d)}
                    aria-label={`Remove ${d}`}
                    className="text-violet-300/70 transition-colors hover:text-violet-100"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={domainDraft}
                onChange={(e) => setDomainDraft(e.target.value)}
                onKeyDown={handleDomainKeyDown}
                onBlur={() => domainDraft.trim() && addDomain(domainDraft)}
                placeholder={domains.length ? "" : "example.com"}
                className="min-w-[120px] flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
              />
            </div>
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

// Custom dropdown to replace native <select> — native options render with
// unstyleable browser chrome (white background, blue highlight) that clashes
// with the app's dark glass theme. Portaled + positioned like AgentDropdown/
// ModelDropdown elsewhere in the app, so it isn't clipped by this modal's
// overflow-y-auto form.
function ThemedSelect<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function handleToggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuStyle({
        position: "fixed",
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      });
    }
    setOpen((v) => !v);
  }

  const selected = options.find((o) => o.value === value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          INPUT_CLS,
          "flex items-center justify-between gap-2 text-left",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className={cn("truncate", !selected && "text-zinc-500")}>
          {selected ? selected.label : "Select…"}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-zinc-500 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={menuStyle}
            className="glass-strong max-h-64 overflow-y-auto rounded-xl p-1.5 shadow-2xl"
          >
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    active ? "bg-violet-500/15 text-violet-200" : "text-zinc-300 hover:bg-white/5",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {active && <Check className="size-3.5 text-violet-400" />}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-400">
        {label}
        {required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-[11px] text-zinc-600">{hint}</p>}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-t border-white/5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-600 first:border-t-0 first:pt-0">
      {children}
    </p>
  );
}
