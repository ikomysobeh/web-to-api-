import { useEffect, useState } from "react";
import { Bot, Pencil, Plus, PowerOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAdminStore } from "@/stores/adminStore";
import { AgentFormModal } from "./AgentFormModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { gradientFor, initialsOf } from "@/lib/gradients";
import { cn } from "@/lib/utils";
import type { Agent } from "@/types/chat";

export function AgentsPage() {
  const navigate = useNavigate();
  const { agents, isLoadingAgents, loadAgents, deactivateAgent } = useAdminStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  function openCreate() {
    setEditAgent(null);
    setFormOpen(true);
  }

  function openEdit(agent: Agent) {
    setEditAgent(agent);
    setFormOpen(true);
  }

  async function handleDeactivate() {
    if (!deactivateId) return;
    await deactivateAgent(deactivateId);
    setDeactivateId(null);
  }

  if (isLoadingAgents) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-orange-500" />
      </div>
    );
  }

  return (
    <div>
      {/* ── Header band ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 border-b border-white/5 px-6 py-6 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/5 text-orange-300">
            <Bot className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Agents</h2>
            <p className="text-xs text-zinc-500">
              {agents.length} {agents.length === 1 ? "agent" : "agents"} configured
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-orange-600 to-amber-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:from-orange-500 hover:to-amber-500 active:scale-[0.98]"
        >
          <Plus className="size-4" />
          Create agent
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-white/5 text-orange-300">
            <Bot className="size-6" />
          </div>
          <p className="text-sm text-zinc-500">No agents yet</p>
          <button
            type="button"
            onClick={openCreate}
            className="text-sm font-medium text-orange-300 transition-colors hover:text-orange-200"
          >
            Create your first agent
          </button>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left">
              <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500 sm:pl-8">Name</th>
              <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Model</th>
              <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Status</th>
              <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Updated</th>
              <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500 sm:pr-8">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {agents.map((agent) => (
              <tr key={agent.id} className="transition-colors hover:bg-white/[0.02]">
                <td className="px-6 py-3 sm:pl-8">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/agents/${agent.id}`)}
                    className="group flex items-center gap-3 text-left"
                  >
                    <div
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-xs font-bold text-white",
                        gradientFor(agent.id),
                      )}
                    >
                      {initialsOf(agent.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-100 transition-colors group-hover:text-orange-400">
                        {agent.name}
                      </p>
                      {agent.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
                          {agent.description}
                        </p>
                      )}
                    </div>
                  </button>
                </td>
                <td className="px-6 py-3">
                  <span className="nums font-mono text-xs text-zinc-400">
                    {agent.model}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                      agent.is_active
                        ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
                        : "bg-white/5 text-zinc-500 ring-white/10",
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        agent.is_active ? "bg-emerald-400" : "bg-zinc-500",
                      )}
                    />
                    {agent.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="nums px-6 py-3 text-xs text-zinc-500">
                  {new Date(agent.updated_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-3 sm:pr-8">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEdit(agent)}
                      aria-label="Edit agent"
                      className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-orange-500/20 hover:text-orange-300"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    {agent.is_active && (
                      <button
                        type="button"
                        onClick={() => setDeactivateId(agent.id)}
                        aria-label="Deactivate agent"
                        className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-red-500/20 hover:text-red-300"
                      >
                        <PowerOff className="size-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {formOpen && (
        <AgentFormModal
          agent={editAgent}
          onClose={() => setFormOpen(false)}
          onCreated={(agent) => navigate(`/admin/agents/${agent.id}`)}
        />
      )}

      <ConfirmDialog
        open={deactivateId !== null}
        title="Deactivate agent"
        description="This agent will be set to inactive and will no longer be available."
        confirmLabel="Deactivate"
        onConfirm={() => void handleDeactivate()}
        onCancel={() => setDeactivateId(null)}
      />
    </div>
  );
}
