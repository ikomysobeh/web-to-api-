import { LayoutDashboard, Bot, ArrowLeft, Code2, Sparkles, Users } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { SidebarFooter } from "@/components/layout/SidebarFooter";

export function AdminSidebar() {
  return (
    <aside className="glass-nav flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-white/5">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-white/5 px-3 py-3">
        <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-md shadow-violet-900/40">
          <Sparkles className="size-3.5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-zinc-100">Lumina AI</p>
          <p className="text-[10px] uppercase tracking-widest text-violet-400/80">Admin</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
        <NavItem to="/admin" icon={LayoutDashboard} label="Dashboard" end />
        <NavItem to="/admin/agents" icon={Bot} label="Agents" />
        <NavItem to="/admin/embed" icon={Code2} label="Embed" />
        <NavItem to="/admin/users" icon={Users} label="Users" />
      </nav>

      {/* Back to chat */}
      <div className="shrink-0 border-t border-white/5 px-3 py-2">
        <NavLink
          to="/chat"
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
        >
          <ArrowLeft className="size-4 shrink-0" />
          Back to chat
        </NavLink>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/5">
        <SidebarFooter collapsed={false} />
      </div>
    </aside>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
  end,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all",
          isActive
            ? "bg-gradient-to-r from-violet-600/25 to-fuchsia-600/10 text-white ring-1 ring-inset ring-violet-500/20"
            : "text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-violet-400 to-fuchsia-400" />
          )}
          <Icon
            className={cn(
              "size-4 shrink-0 transition-colors",
              isActive ? "text-violet-300" : "text-zinc-500 group-hover:text-zinc-300",
            )}
          />
          {label}
        </>
      )}
    </NavLink>
  );
}
