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
    <div>
      {/* ── Header band ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-white/5 px-6 py-6 sm:px-8">
        <div className="flex size-9 items-center justify-center rounded-lg bg-white/5 text-sky-300">
          <UsersIcon className="size-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Users</h2>
          <p className="text-xs text-zinc-500">
            {users.length} {users.length === 1 ? "user" : "users"} in the system
          </p>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-white/5 text-sky-300">
            <UsersIcon className="size-6" />
          </div>
          <p className="text-sm text-zinc-500">No users found</p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left">
              <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500 sm:pl-8">User</th>
              <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Role</th>
              <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500 sm:pr-8">ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {users.map((user) => {
              const isAdmin = user.role.toLowerCase() === "admin";
              return (
                <tr key={user.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-6 py-3 sm:pl-8">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-xs font-bold text-white",
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
                  <td className="px-6 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                        isAdmin
                          ? "bg-violet-500/10 text-violet-300 ring-violet-400/20"
                          : "bg-white/5 text-zinc-400 ring-white/10",
                      )}
                    >
                      {isAdmin && <Shield className="size-3" />}
                      {user.role}
                    </span>
                  </td>
                  <td className="nums px-6 py-3 text-xs text-zinc-500 sm:pr-8">
                    {user.id}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
