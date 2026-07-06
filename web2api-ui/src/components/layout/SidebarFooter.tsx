import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useConversationStore } from "@/stores/conversationStore";
import { disconnectCookies, postLogout } from "@/services/api";
import { cn } from "@/lib/utils";

interface SidebarFooterProps {
  collapsed: boolean;
}

export function SidebarFooter({ collapsed }: SidebarFooterProps) {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const resetForLogout = useConversationStore((s) => s.resetForLogout);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);

  const email = user?.email ?? "";
  const initials = email ? email.slice(0, 2).toUpperCase() : "AI";

  // Close dropdown on outside click — the collapsed menu is portaled to
  // document.body, so it's no longer a DOM descendant of wrapperRef.
  useEffect(() => {
    function handle(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setDropdownOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  function toggleCollapsedMenu() {
    if (!dropdownOpen && avatarBtnRef.current) {
      const rect = avatarBtnRef.current.getBoundingClientRect();
      setMenuStyle({
        position: "fixed",
        bottom: window.innerHeight - rect.bottom,
        left: rect.right + 8,
        zIndex: 9999,
      });
    }
    setDropdownOpen((v) => !v);
  }

  async function handleLogout() {
    setDropdownOpen(false);
    if (token) {
      // Disconnect Gemini (delete cookies + drop WebAI client) before logging
      // out, while the token is still valid. Awaited so it completes first;
      // errors are swallowed so logout always proceeds.
      await disconnectCookies(token).catch(() => {});
      void postLogout(token).catch(() => {});
    }
    resetForLogout();
    logout();
    navigate("/login");
  }

  const dropdown = (
    <div className="glass-strong absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-xl py-1">
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

  // ── Collapsed: click avatar to open a fixed-width flyout ─────────────────
  // Portaled to document.body and positioned via getBoundingClientRect —
  // the collapsed rail's <aside> has overflow-hidden (needed so the narrow
  // rail itself never scrolls), which clipped this menu entirely when it was
  // just an absolutely-positioned child. A portal escapes that clipping.
  if (collapsed) {
    return (
      <div ref={wrapperRef} className="relative flex flex-col items-center py-2">
        <button
          ref={avatarBtnRef}
          type="button"
          onClick={toggleCollapsedMenu}
          aria-label="Account menu"
          className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-[10px] font-bold text-white shadow-md shadow-violet-950/40 transition-transform hover:scale-105"
        >
          {initials}
        </button>
        {dropdownOpen &&
          createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className="glass-strong w-44 overflow-hidden rounded-xl py-1 shadow-2xl"
            >
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-red-400"
              >
                <LogOut className="size-4 shrink-0 text-zinc-500" />
                Sign out
              </button>
            </div>,
            document.body,
          )}
      </div>
    );
  }

  // ── Expanded ──────────────────────────────────────────────────────────────
  return (
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
  );
}
