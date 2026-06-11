import { LayoutDashboard, Bot, ArrowLeft, Sparkles, Users } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { SidebarFooter } from "@/components/layout/SidebarFooter";

export function AdminSidebar() {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-zinc-800/70 bg-zinc-950">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-zinc-800/70 px-3 py-3">
        <div className="flex size-7 items-center justify-center rounded-lg bg-violet-600">
          <Sparkles className="size-3.5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-zinc-100">Lumina AI</p>
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">Admin</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <NavItem to="/admin" icon={LayoutDashboard} label="Dashboard" end />
        <NavItem to="/admin/agents" icon={Bot} label="Agents" />
        <NavItem to="/admin/users" icon={Users} label="Users" />
      </nav>

      {/* Back to chat */}
      <div className="shrink-0 border-t border-zinc-800/50 px-3 py-2">
        <NavLink
          to="/chat"
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-800/40 hover:text-zinc-300"
        >
          <ArrowLeft className="size-4 shrink-0" />
          Back to chat
        </NavLink>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-zinc-800/70">
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
          "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-zinc-800/60 text-zinc-100"
            : "text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300",
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </NavLink>
  );
}
