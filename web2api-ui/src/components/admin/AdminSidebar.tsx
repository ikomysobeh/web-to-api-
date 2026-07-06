import { LayoutDashboard, Bot, ArrowLeft, ChevronLeft, ChevronRight, Code2, Pizza, Sparkles, Users } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { SidebarFooter } from "@/components/layout/SidebarFooter";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface AdminSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Hides the expand chevron — used for the persistent mobile rail, which has
   *  nothing to expand into (a w-64 nav would break a phone-width layout). */
  hideToggle?: boolean;
}

const NAV_ITEMS = [
  { to: "/admin", icon: LayoutDashboard, label: "Dashboard", end: true },
  { to: "/admin/agents", icon: Bot, label: "Agents", end: false },
  { to: "/admin/embed", icon: Code2, label: "Embed", end: false },
  { to: "/admin/users", icon: Users, label: "Users", end: false },
] as const;

export function AdminSidebar({ collapsed, onToggleCollapse, hideToggle = false }: AdminSidebarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  function isItemActive(to: string, end: boolean) {
    return end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  }

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "glass-nav flex h-full shrink-0 flex-col overflow-hidden border-r border-white/5 transition-[width] duration-200 ease-in-out",
          collapsed ? "w-14 items-center" : "w-64",
        )}
      >
        {collapsed ? (
          <>
            {/* Logo mark */}
            <div className="flex shrink-0 flex-col items-center border-b border-white/5 py-3">
              <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 shadow-md shadow-orange-900/40">
                <Sparkles className="size-3.5 text-white" />
              </div>
            </div>

            {/* Icon nav — plain buttons, uniform box treatment for every icon */}
            <nav className="flex flex-col items-center gap-1 py-2">
              {!hideToggle && (
                <>
                  <IconBtn icon={ChevronRight} label="Expand sidebar" onClick={onToggleCollapse} />
                  <div className="my-1 h-px w-6 bg-white/5" />
                </>
              )}
              {NAV_ITEMS.map((item) => (
                <IconBtn
                  key={item.to}
                  icon={item.icon}
                  label={item.label}
                  active={isItemActive(item.to, item.end)}
                  onClick={() => navigate(item.to)}
                />
              ))}
            </nav>

            <div className="flex-1" />

            {/* Back to chat */}
            <div className="shrink-0 border-t border-white/5 py-2">
              <IconBtn icon={ArrowLeft} label="Back to chat" onClick={() => navigate("/chat")} />
            </div>

            {/* Footer */}
            <div className="w-full border-t border-white/5">
              <SidebarFooter collapsed />
            </div>
          </>
        ) : (
          <>
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-2.5 border-b border-white/5 px-3 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 shadow-md shadow-orange-900/40">
                  <Pizza className="size-3.5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold tracking-tight text-zinc-100">PNE LC AI</p>
                  <p className="text-[10px] uppercase tracking-widest text-orange-400/80">Admin</p>
                </div>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onToggleCollapse}
                    aria-label="Collapse sidebar"
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Collapse</TooltipContent>
              </Tooltip>
            </div>

            {/* Nav */}
            <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
              {NAV_ITEMS.map((item) => (
                <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} end={item.end} />
              ))}
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
          </>
        )}
      </aside>
    </TooltipProvider>
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
            ? "bg-gradient-to-r from-orange-600/25 to-amber-600/10 text-white ring-1 ring-inset ring-orange-500/20"
            : "text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-orange-400 to-amber-400" />
          )}
          <Icon
            className={cn(
              "size-4 shrink-0 transition-colors",
              isActive ? "text-orange-300" : "text-zinc-500 group-hover:text-zinc-300",
            )}
          />
          {label}
        </>
      )}
    </NavLink>
  );
}

// Plain button + Tooltip — same proven pattern as the chat sidebar's collapsed
// rail. Avoids wrapping NavLink (whose className is a function) inside a
// Radix Tooltip asChild slot, which rendered inconsistent, oversized boxes.
function IconBtn({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
            active
              ? "bg-gradient-to-br from-orange-600/30 to-amber-600/15 text-orange-300 ring-1 ring-inset ring-orange-500/20"
              : "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200",
          )}
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
