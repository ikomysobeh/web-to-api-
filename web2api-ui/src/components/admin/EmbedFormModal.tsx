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
  "flex h-9 w-full rounded-md border border-white/10 bg-white/5 px-3 py-1 text-sm text-zinc-100 outline-none transition-[color,box-shadow] placeholder:text-zinc-500 focus-visible:border-orange-400/50 focus-visible:ring-2 focus-visible:ring-orange-400/20 disabled:cursor-not-allowed disabled:opacity-50";

export function EmbedFormModal({ embed, onClose, onCreated }: EmbedFormModalProps) {
  const { agents, loadAgents } = useAdminStore();
  const { createEmbed, updateEmbed, isSaving } = useEmbedStore();

  const [agentId, setAgentId] = useState(embed?.agent_id ?? "");
  const [title, setTitle] = useState(embed?.config?.title ?? "PNE LC AI Assistant");
  const [greeting, setGreeting] = useState(embed?.config?.greeting ?? "Hi! How can I help you today?");
  const [accentColor, setAccentColor] = useState(embed?.config?.accentColor ?? "#f97316");
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
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-white/10 bg-zinc-900/95 shadow-2xl backdrop-blur-xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">
            {embed ? "Edit widget" : "Create widget"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Scrollable form */}
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex flex-col gap-5 overflow-y-auto px-6 py-5"
        >
          {/* ── Agent & content ── */}
          <SectionLabel first>Agent &amp; content</SectionLabel>

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
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={INPUT_CLS}
            />
          </Field>

          <Field label="Greeting message">
            <input
              type="text"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              className={INPUT_CLS}
            />
          </Field>

          {/* ── Appearance ── */}
          <SectionLabel>Appearance</SectionLabel>

          {/* Live preview */}
          <div className="relative h-24 overflow-hidden rounded-lg border border-white/10 bg-white/5">
            <span className="absolute left-3 top-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Preview
            </span>
            <div
              className={cn(
                "absolute flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-white shadow-md",
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
                  className="size-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-white/10 bg-zinc-800 p-0.5"
                />
                <input
                  type="text"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className={INPUT_CLS}
                />
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

          {/* ── Access ── */}
          <SectionLabel>Access</SectionLabel>

          <Field
            label="Allowed domains"
            hint="Press Enter after each one · leave empty to allow any site"
          >
            <div
              className={cn(
                "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm transition-[color,box-shadow] focus-within:border-orange-400/50 focus-within:ring-2 focus-within:ring-orange-400/20",
              )}
            >
              {domains.map((d) => (
                <span
                  key={d}
                  className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-xs font-medium text-zinc-300 ring-1 ring-inset ring-white/10"
                >
                  {d}
                  <button
                    type="button"
                    onClick={() => removeDomain(d)}
                    aria-label={`Remove ${d}`}
                    className="text-zinc-500 transition-colors hover:text-zinc-200"
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

          {/* Active toggle — edit only */}
          {embed && (
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <span className="text-sm font-medium text-zinc-100">Active</span>
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                aria-checked={isActive}
                role="switch"
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50",
                  isActive ? "bg-orange-600" : "bg-zinc-600",
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

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex h-9 items-center justify-center rounded-md bg-orange-600 px-4 text-sm font-medium text-white shadow-xs transition-colors hover:bg-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? "Saving…" : embed ? "Save changes" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// ── ThemedSelect ─────────────────────────────────────────────────────────────
// Custom dropdown — native <select> options can't be themed. Portaled so it
// isn't clipped by the modal's overflow-y-auto.
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
          !selected?.value && "text-zinc-400",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="truncate">{selected ? selected.label : "Select…"}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-zinc-400 transition-transform duration-200",
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
            className="overflow-hidden rounded-lg border border-white/10 bg-zinc-900 p-1 shadow-2xl ring-1 ring-inset ring-white/5"
          >
            {options.map((opt, idx) => {
              const active = opt.value === value;
              const isPlaceholder = idx === 0 && opt.value === "";
              return (
                <div key={opt.value}>
                  {idx === 1 && options[0]?.value === "" && (
                    <div className="mx-2 my-1 h-px bg-white/8" />
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      active && !isPlaceholder
                        ? "bg-orange-500/15 text-orange-200"
                        : isPlaceholder
                          ? "text-zinc-500 hover:bg-white/5"
                          : "text-zinc-300 hover:bg-white/8",
                    )}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {active && !isPlaceholder && (
                        <Check className="size-3.5 text-orange-400" />
                      )}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

// ── Field ────────────────────────────────────────────────────────────────────
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
    <div className="flex flex-col gap-1.5">
      <label className="select-none text-sm font-medium leading-none text-zinc-300">
        {label}
        {required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

// ── SectionLabel ─────────────────────────────────────────────────────────────
function SectionLabel({ children, first }: { children: React.ReactNode; first?: boolean }) {
  if (first) {
    return (
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {children}
      </p>
    );
  }
  return (
    <div className="flex items-center gap-3 py-0.5">
      <div className="h-px flex-1 bg-white/10" />
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {children}
      </span>
      <div className="h-px flex-1 bg-white/10" />
    </div>
  );
}
