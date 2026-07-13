import { useEffect, useState } from "react";
import { Shield, Users as UsersIcon } from "lucide-react";
import { useAdminStore } from "@/stores/adminStore";
import { gradientFor, initialsOf } from "@/lib/gradients";
import { cn } from "@/lib/utils";

export function UsersPage() {
  const { users, isLoadingUsers, loadUsers, usersPagination } = useAdminStore();
  const [page] = useState(1);

  useEffect(() => {
    void loadUsers(page);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const { total } = usersPagination;

  if (isLoadingUsers) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-orange-500" />
      </div>
    );
  }

  return (
    <div>
      {/* ── Header band ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-white/5 px-6 py-6 sm:px-8">
        <div className="flex size-9 items-center justify-center rounded-lg bg-white/5 text-orange-300">
          <UsersIcon className="size-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Users</h2>
          <p className="text-xs text-zinc-500">
            {total} {total === 1 ? "user" : "users"} in the system
          </p>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-white/5 text-orange-300">
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
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                          isAdmin
                            ? "bg-orange-500/10 text-orange-300 ring-orange-400/20"
                            : "bg-white/5 text-zinc-400 ring-white/10",
                        )}
                      >
                        {isAdmin ? (
                          <Shield className="size-3" />
                        ) : (
                          <span className="size-1.5 rounded-full bg-zinc-500" />
                        )}
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

          {/* Pagination */}
          {lastPage > 1 && (
            <div className="flex items-center justify-between border-t border-white/5 px-6 py-4 sm:px-8">
              <p className="text-xs text-zinc-500">
                Page {currentPage} of {lastPage} · {total} users
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronLeft className="size-4" />
                </button>
                {Array.from({ length: lastPage }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === lastPage || Math.abs(p - currentPage) <= 1)
                  .reduce<(number | "…")[]>((acc, p, i, arr) => {
                    if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === "…" ? (
                      <span key={`ellipsis-${i}`} className="px-1 text-xs text-zinc-600">…</span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPage(p as number)}
                        className={cn(
                          "flex size-8 items-center justify-center rounded-lg text-xs transition-colors",
                          p === currentPage
                            ? "bg-orange-600 font-medium text-white"
                            : "border border-white/10 text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
                        )}
                      >
                        {p}
                      </button>
                    ),
                  )}
                <button
                  type="button"
                  disabled={currentPage >= lastPage}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
