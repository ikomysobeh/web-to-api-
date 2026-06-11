import { useEffect } from "react";
import { useAdminStore } from "@/stores/adminStore";

export function AdminDashboard() {
  const { agents, isLoadingAgents, loadAgents } = useAdminStore();

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const total = agents.length;
  const active = agents.filter((a) => a.is_active).length;
  const inactive = total - active;

  if (isLoadingAgents) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-6 text-lg font-semibold text-zinc-100">Overview</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Total Agents", value: total },
          { label: "Active", value: active },
          { label: "Inactive", value: inactive },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-zinc-800 bg-zinc-900 px-6 py-5"
          >
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              {card.label}
            </p>
            <p className="mt-2 text-3xl font-bold text-zinc-100">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
