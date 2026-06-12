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
    { label: "Total Agents", value: total, icon: Bot, grad: "from-violet-500 to-fuchsia-500" },
    { label: "Active", value: active, icon: CheckCircle2, grad: "from-indigo-500 to-violet-500" },
    { label: "Inactive", value: inactive, icon: PauseCircle, grad: "from-sky-500 to-blue-500" },
    { label: "Users", value: users.length, icon: Users, grad: "from-fuchsia-500 to-purple-500" },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="glass relative mb-8 overflow-hidden rounded-3xl p-8">
        <div className="pointer-events-none absolute -right-10 -top-10 size-56 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 opacity-25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 right-28 size-44 rounded-full bg-gradient-to-br from-indigo-500 to-sky-500 opacity-15 blur-3xl" />
        <div className="relative flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-violet-300">
          <Sparkles className="size-3.5" />
          Admin console
        </div>
        <h2 className="relative mt-3 text-3xl font-semibold tracking-tight text-white text-balance">
          Welcome back,{" "}
          <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-indigo-300 bg-clip-text text-transparent">
            {firstName}
          </span>
        </h2>
        <p className="relative mt-1.5 max-w-md text-sm leading-relaxed text-zinc-400">
          Manage your agents, knowledge bases, and user access — all from one place.
        </p>

        <div className="relative mt-5 flex flex-wrap gap-2.5">
          <Link
            to="/admin/agents"
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-violet-950/50 transition-all hover:shadow-violet-900/60 active:scale-[0.98]"
          >
            <Plus className="size-4" />
            New agent
          </Link>
          <Link
            to="/admin/users"
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 backdrop-blur-sm transition-all hover:bg-white/10 active:scale-[0.98]"
          >
            <UserPlus className="size-4" />
            Manage users
          </Link>
        </div>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((card) => (
          <div
            key={card.label}
            className="glass group relative overflow-hidden rounded-2xl p-5 transition-all hover:-translate-y-0.5"
          >
            <div
              className={cn(
                "pointer-events-none absolute -right-6 -top-6 size-24 rounded-full bg-gradient-to-br opacity-25 blur-2xl transition-opacity group-hover:opacity-40",
                card.grad,
              )}
            />
            <div
              className={cn(
                "relative flex size-11 items-center justify-center rounded-xl bg-gradient-to-br shadow-lg",
                card.grad,
              )}
            >
              <card.icon className="size-5 text-white" />
            </div>
            <p className="nums relative mt-4 text-3xl font-semibold text-zinc-100">
              {card.value}
            </p>
            <p className="relative mt-0.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
              {card.label}
            </p>
          </div>
        ))}
      </div>

      {/* ── Recent agents ────────────────────────────────────────────── */}
      <div className="glass mt-8 overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-3.5">
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
          <ul className="divide-y divide-white/5">
            {recentAgents.map((agent) => (
              <li key={agent.id}>
                <Link
                  to={`/admin/agents/${agent.id}`}
                  className="flex items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-white/5"
                >
                  <div
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xs font-bold text-white shadow-md",
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
                        ? "bg-emerald-500/15 text-emerald-300 ring-emerald-400/20"
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
