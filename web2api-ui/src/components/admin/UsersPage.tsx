import { useEffect } from "react";
import { useAdminStore } from "@/stores/adminStore";

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
    <>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Users</h2>
      </div>

      {users.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-800">
          <p className="text-sm text-zinc-500">No users found</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left">
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">ID</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Email</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Role</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">External ID</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Synced At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {users.map((user) => (
                <tr key={user.id} className="transition-colors hover:bg-zinc-800/30">
                  <td className="px-4 py-3 text-xs text-zinc-500">{user.id}</td>
                  <td className="px-4 py-3 font-medium text-zinc-100">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-400 ring-1 ring-inset ring-zinc-700/40">
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {user.external_id ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {user.synced_at ? new Date(user.synced_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
