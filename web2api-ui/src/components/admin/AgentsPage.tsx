import { useEffect, useState } from "react";
import { Pencil, PowerOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAdminStore } from "@/stores/adminStore";
import { AgentFormModal } from "./AgentFormModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
        <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Agents</h2>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
        >
          Create agent
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-800">
          <p className="text-sm text-zinc-500">No agents yet</p>
          <button
            type="button"
            onClick={openCreate}
            className="text-sm text-violet-400 transition-colors hover:text-violet-300"
          >
            Create your first agent
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left">
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Name</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Model</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Status</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Updated</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {agents.map((agent) => (
                <tr key={agent.id} className="transition-colors hover:bg-zinc-800/30">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/agents/${agent.id}`)}
                      className="text-left transition-colors hover:text-violet-400"
                    >
                      <p className="font-medium text-zinc-100">{agent.name}</p>
                      {agent.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
                          {agent.description}
                        </p>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{agent.model}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        agent.is_active
                          ? "rounded-full bg-green-950/60 px-2.5 py-0.5 text-xs font-medium text-green-400 ring-1 ring-inset ring-green-900/40"
                          : "rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-500 ring-1 ring-inset ring-zinc-700/40"
                      }
                    >
                      {agent.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {new Date(agent.updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(agent)}
                        aria-label="Edit agent"
                        className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      {agent.is_active && (
                        <button
                          type="button"
                          onClick={() => setDeactivateId(agent.id)}
                          aria-label="Deactivate agent"
                          className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-red-950/40 hover:text-red-400"
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
        </div>
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
    </>
  );
}
