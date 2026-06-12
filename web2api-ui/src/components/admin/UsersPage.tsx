import { useEffect } from "react";
import { Shield, Users as UsersIcon } from "lucide-react";
import { useAdminStore } from "@/stores/adminStore";
import { gradientFor, initialsOf } from "@/lib/gradients";
import { cn } from "@/lib/utils";

export function UsersPage() {
  const { users, isLoadingUsers, loadUsers } = useAdminStore();

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  if (isLoadingUsers) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-center gap-3.5">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 shadow-lg shadow-blue-900/30">
          <UsersIcon className="size-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Users</h2>
          <p className="text-xs text-zinc-500">
            {users.length} {users.length === 1 ? "user" : "users"} in the system
          </p>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="glass flex h-48 flex-col items-center justify-center gap-3 rounded-2xl">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500/20 to-blue-500/20 ring-1 ring-inset ring-white/10">
            <UsersIcon className="size-6 text-sky-300" />
          </div>
          <p className="text-sm text-zinc-500">No users found</p>
        </div>
      ) : (
        <div className="glass overflow-hidden rounded-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/5 text-left">
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">User</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Role</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.map((user) => {
                const isAdmin = user.role.toLowerCase() === "admin";
                return (
                  <tr key={user.id} className="transition-colors hover:bg-white/5">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xs font-bold text-white shadow-md",
                            gradientFor(user.email),
                          )}
                        >
                          {initialsOf(user.name ?? user.email)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-zinc-100">
                            {user.name}
                          </p>
                          <p className="truncate text-xs text-zinc-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                          isAdmin
                            ? "bg-violet-500/15 text-violet-300 ring-violet-400/20"
                            : "bg-white/5 text-zinc-400 ring-white/10",
                        )}
                      >
                        {isAdmin && <Shield className="size-3" />}
                        {user.role}
                      </span>
                    </td>
                    <td className="nums px-4 py-3 text-xs text-zinc-500">
                      {user.id}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
