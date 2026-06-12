import { useEffect, useRef, useState } from "react";
import { LogOut, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useConversationStore } from "@/stores/conversationStore";
import { postLogout } from "@/services/api";
import { SettingsModal } from "@/components/modals/SettingsModal";
import { cn } from "@/lib/utils";

interface SidebarFooterProps {
  collapsed: boolean;
}

export function SidebarFooter({ collapsed }: SidebarFooterProps) {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const resetForLogout = useConversationStore((s) => s.resetForLogout);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const email = user?.email ?? "";
  const initials = email ? email.slice(0, 2).toUpperCase() : "AI";

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  async function handleLogout() {
    setDropdownOpen(false);
    if (token) void postLogout(token).catch(() => {});
    resetForLogout();
    logout();
    navigate("/login");
  }

  function handleOpenSettings() {
    setDropdownOpen(false);
    setSettingsOpen(true);
  }

  const dropdown = (
    <div className="glass-strong absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-xl py-1">
      <button
        type="button"
        onClick={handleOpenSettings}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
      >
        <Settings className="size-4 shrink-0 text-zinc-500" />
        Settings
      </button>
      <button
        type="button"
        onClick={handleLogout}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-red-400"
      >
        <LogOut className="size-4 shrink-0 text-zinc-500" />
        Sign out
      </button>
    </div>
  );

  // ── Collapsed: click avatar to open dropdown ──────────────────────────────
  if (collapsed) {
    return (
      <>
        <div ref={wrapperRef} className="relative flex flex-col items-center py-2">
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            aria-label="Account menu"
            className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-[10px] font-bold text-white shadow-md shadow-violet-950/40 transition-transform hover:scale-105"
          >
            {initials}
          </button>
          {dropdownOpen && dropdown}
        </div>
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </>
    );
  }

  // ── Expanded ──────────────────────────────────────────────────────────────
  return (
    <>
      <div ref={wrapperRef} className="relative">
        <button
          type="button"
          onClick={() => setDropdownOpen((v) => !v)}
          aria-label="Account menu"
          className={cn(
            "flex w-full items-center gap-2.5 px-3 py-3 transition-colors hover:bg-white/5",
            dropdownOpen && "bg-white/5",
          )}
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-[10px] font-bold text-white shadow-md shadow-violet-950/40">
            {initials}
          </div>
          <p className="min-w-0 flex-1 truncate text-left text-sm text-zinc-300">{email}</p>
        </button>

        {dropdownOpen && dropdown}
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
