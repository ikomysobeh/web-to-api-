import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  PauseCircle,
  Plus,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";
import { useAdminStore } from "@/stores/adminStore";
import { useAuth } from "@/context/AuthContext";
import { gradientFor, initialsOf } from "@/lib/gradients";
import { cn } from "@/lib/utils";

export function AdminDashboard() {
  const { agents, users, isLoadingAgents, loadAgents, loadUsers } = useAdminStore();
  const { user } = useAuth();

  useEffect(() => {
    void loadAgents();
    void loadUsers();
  }, [loadAgents, loadUsers]);

  const firstName = user?.email
    ? user.email.split("@")[0][0].toUpperCase() + user.email.split("@")[0].slice(1)
    : "there";

  const total = agents.length;
  const active = agents.filter((a) => a.is_active).length;
  const inactive = total - active;

  const recentAgents = [...agents]
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
    .slice(0, 5);

  if (isLoadingAgents) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
      </div>
    );
  }

  const stats = [
    { label: "Total Agents", value: total, icon: Bot, color: "text-violet-300" },
    { label: "Active", value: active, icon: CheckCircle2, color: "text-emerald-300" },
    { label: "Inactive", value: inactive, icon: PauseCircle, color: "text-sky-300" },
    { label: "Users", value: users.length, icon: Users, color: "text-fuchsia-300" },
  ];

  return (
    <div>
      {/* ── Header band ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5 px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-violet-300/80">
            <Sparkles className="size-3.5" />
            Admin console
          </div>
          <h2 className="mt-2.5 text-2xl font-semibold tracking-tight text-white">
            Welcome back,{" "}
            <span className="text-violet-300">{firstName}</span>
          </h2>
          <p className="mt-1 max-w-md text-sm text-zinc-500">
            Manage your agents, knowledge bases, and user access — all from one place.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2.5">
          <Link
            to="/admin/agents"
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:from-violet-500 hover:to-fuchsia-500 active:scale-[0.98]"
          >
            <Plus className="size-4" />
            New agent
          </Link>
          <Link
            to="/admin/users"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-zinc-100 active:scale-[0.98]"
          >
            <UserPlus className="size-4" />
            Manage users
          </Link>
        </div>
      </div>

      {/* ── Stat cards — flat, centered, no borders ──────────────────── */}
      <div className="grid grid-cols-2 gap-y-8  px-6 py-8 sm:grid-cols-4 sm:px-8">
        {stats.map((card) => (
          <div
            key={card.label}
            className="flex flex-col items-center text-center"
          >
            <card.icon className={cn("size-10", card.color)} />
            <p className="nums mt-3.5 text-3xl font-semibold tracking-tight text-zinc-50">
              {card.value}
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
              {card.label}
            </p>
          </div>
        ))}
      </div>

      {/* ── Recent agents ────────────────────────────────────────────── */}
      <div className="px-6 py-7 sm:px-8">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">Recent agents</h3>
          <Link
            to="/admin/agents"
            className="flex items-center gap-1 text-xs font-medium text-violet-300 transition-colors hover:text-violet-200"
          >
            View all
            <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {recentAgents.length === 0 ? (
          <div className="flex h-28 flex-col items-center justify-center gap-2">
            <p className="text-sm text-zinc-500">No agents yet</p>
            <Link
              to="/admin/agents"
              className="text-sm text-violet-300 transition-colors hover:text-violet-200"
            >
              Create your first agent
            </Link>
          </div>
        ) : (
          <ul className="-mx-2 divide-y divide-white/5">
            {recentAgents.map((agent) => (
              <li key={agent.id}>
                <Link
                  to={`/admin/agents/${agent.id}`}
                  className="flex items-center gap-3.5 rounded-lg px-2 py-3 transition-colors hover:bg-white/5"
                >
                  <div
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-xs font-bold text-white",
                      gradientFor(agent.id),
                    )}
                  >
                    {initialsOf(agent.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {agent.name}
                    </p>
                    <p className="truncate text-xs text-zinc-500">{agent.model}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                      agent.is_active
                        ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
                        : "bg-white/5 text-zinc-500 ring-white/10",
                    )}
                  >
                    {agent.is_active ? "Active" : "Inactive"}
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-zinc-600" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
