import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, FileText, Pencil, PowerOff, Trash2, Upload, UserPlus, UserX } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useAdminStore } from "@/stores/adminStore";
import { getAgent } from "@/services/api";
import { AgentFormModal } from "./AgentFormModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import type { Agent } from "@/types/chat";

export function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();

  const {
    agents,
    documentsByAgentId,
    isLoadingDocs,
    isUploading,
    loadDocuments,
    uploadDocument,
    deleteDocument,
    deactivateAgent,
    assignedUsersByAgentId,
    isLoadingAgentUsers,
    isAssigning,
    loadAgentUsers,
    assignAgentUsers,
    removeAgentUser,
    users,
    loadUsers,
  } = useAdminStore();

  // Prefer agent from store (stays live after edits); fall back to fetched copy
  const agentFromStore = agents.find((a) => a.id === agentId);
  const [localAgent, setLocalAgent] = useState<Agent | null>(null);
  const [isLoadingAgent, setIsLoadingAgent] = useState(!agentFromStore);

  const agent: Agent | null = agentFromStore ?? localAgent;

  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deleteDocFilename, setDeleteDocFilename] = useState<string | null>(null);
  const [uploadFeedback, setUploadFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const docs = documentsByAgentId[agentId ?? ""] ?? [];
  const assignedUsers = assignedUsersByAgentId[agentId ?? ""] ?? [];
  const [assignPanelOpen, setAssignPanelOpen] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [removeUserId, setRemoveUserId] = useState<number | null>(null);

  useEffect(() => {
    if (!agentId || !token) return;
    if (!agentFromStore) {
      setIsLoadingAgent(true);
      getAgent(token, agentId)
        .then((data) => setLocalAgent(data.agent))
        .catch(() => navigate("/admin/agents"))
        .finally(() => setIsLoadingAgent(false));
    }
    void loadDocuments(agentId);
    void loadAgentUsers(agentId);
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, token]);

  async function handleFile(file: File) {
    if (!agentId) return;
    setUploadFeedback(null);
    try {
      await uploadDocument(agentId, file);
      setUploadFeedback({ type: "success", message: `"${file.name}" uploaded successfully` });
    } catch (err) {
      let msg = "Upload failed. Please try again.";
      if (err instanceof Response) {
        try {
          const body = (await err.json()) as { detail?: string };
          msg = body.detail ?? msg;
        } catch { /* ignore */ }
      }
      setUploadFeedback({ type: "error", message: msg });
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void handleFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  async function handleDeactivate() {
    if (!agentId) return;
    await deactivateAgent(agentId);
    setDeactivateOpen(false);
  }

  async function handleDeleteDoc() {
    if (!deleteDocFilename || !agentId) return;
    await deleteDocument(agentId, deleteDocFilename);
    setDeleteDocFilename(null);
  }

  function toggleUserSelection(userId: number) {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  }

  async function handleAssign() {
    if (!agentId || selectedUserIds.length === 0) return;
    await assignAgentUsers(agentId, selectedUserIds);
    setSelectedUserIds([]);
    setAssignPanelOpen(false);
  }

  async function handleRemoveUser() {
    if (!removeUserId || !agentId) return;
    await removeAgentUser(agentId, removeUserId);
    setRemoveUserId(null);
  }

  if (isLoadingAgent || !agent) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
      </div>
    );
  }

  return (
    <>
      {/* Back link + actions */}
      <div className="mb-6 flex items-center justify-between">
        <Link
          to="/admin/agents"
          className="flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <ArrowLeft className="size-3.5" />
          Agents
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
          {agent.is_active && (
            <button
              type="button"
              onClick={() => setDeactivateOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-red-900/40 bg-red-950/20 px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-950/40"
            >
              <PowerOff className="size-3.5" />
              Deactivate
            </button>
          )}
        </div>
      </div>

      {/* Agent info card */}
      <div className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-zinc-100">{agent.name}</h2>
            {agent.description && (
              <p className="mt-1 text-sm text-zinc-400">{agent.description}</p>
            )}
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
              agent.is_active
                ? "bg-green-950/60 text-green-400 ring-green-900/40"
                : "bg-zinc-800 text-zinc-500 ring-zinc-700/40",
            )}
          >
            {agent.is_active ? "Active" : "Inactive"}
          </span>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
          <span>
            Model: <span className="text-zinc-400">{agent.model}</span>
          </span>
          <span>
            Updated:{" "}
            <span className="text-zinc-400">
              {new Date(agent.updated_at).toLocaleDateString()}
            </span>
          </span>
        </div>

        {agent.instructions && (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Instructions
            </p>
            <pre className="whitespace-pre-wrap rounded-xl bg-zinc-800/50 px-4 py-3 font-sans text-xs leading-relaxed text-zinc-300">
              {agent.instructions}
            </pre>
          </div>
        )}
      </div>

      {/* Knowledge Base */}
      <div>
        <h3 className="mb-4 text-base font-semibold text-zinc-100">Knowledge Base</h3>

        {/* Upload zone */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => !isUploading && fileInputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && !isUploading && fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className={cn(
            "mb-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-8 transition-colors",
            isUploading
              ? "cursor-default border-violet-700/50 bg-violet-950/20"
              : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/30",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            onChange={handleInputChange}
            className="hidden"
          />
          {isUploading ? (
            <>
              <div className="size-5 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
              <p className="text-sm text-zinc-400">Uploading…</p>
            </>
          ) : (
            <>
              <Upload className="size-5 text-zinc-500" />
              <p className="text-sm text-zinc-400">
                Drop a file or{" "}
                <span className="text-violet-400">click to browse</span>
              </p>
              <p className="text-xs text-zinc-600">.pdf · .docx · .txt · .md</p>
            </>
          )}
        </div>

        {/* Upload feedback */}
        {uploadFeedback && (
          <div
            className={cn(
              "mb-4 rounded-xl px-4 py-3 text-sm",
              uploadFeedback.type === "success"
                ? "bg-green-950/30 text-green-400 ring-1 ring-inset ring-green-900/40"
                : "bg-red-950/30 text-red-400 ring-1 ring-inset ring-red-900/40",
            )}
          >
            {uploadFeedback.message}
          </div>
        )}

        {/* Documents list */}
        {isLoadingDocs ? (
          <div className="flex h-20 items-center justify-center">
            <div className="size-5 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
          </div>
        ) : docs.length === 0 ? (
          <div className="flex h-20 flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800">
            <p className="text-sm text-zinc-600">No documents yet — upload your first file above</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
            <div className="border-b border-zinc-800 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Documents ({docs.length})
            </div>
            <ul className="divide-y divide-zinc-800">
              {docs.map((doc) => (
                <li key={doc.filename} className="flex items-center gap-3 px-4 py-3">
                  <FileText className="size-4 shrink-0 text-zinc-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {doc.filename}
                    </p>
                    <p className="text-xs text-zinc-500">{doc.chunk_count} chunks</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteDocFilename(doc.filename)}
                    aria-label={`Delete ${doc.filename}`}
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-red-950/40 hover:text-red-400"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Assigned Users */}
      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-100">Assigned Users</h3>
          <button
            type="button"
            onClick={() => {
              setAssignPanelOpen((v) => !v);
              setSelectedUserIds([]);
            }}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
          >
            <UserPlus className="size-3.5" />
            Add users
          </button>
        </div>

        {/* Assign panel */}
        {assignPanelOpen && (
          <div className="mb-4 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900">
            <div className="border-b border-zinc-800 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Select users to assign
            </div>
            {(() => {
              const unassigned = users.filter(
                (u) => !assignedUsers.some((a) => a.id === u.id),
              );
              return unassigned.length === 0 ? (
                <p className="px-4 py-4 text-sm text-zinc-500">
                  All users are already assigned to this agent.
                </p>
              ) : (
                <>
                  <ul className="max-h-48 divide-y divide-zinc-800 overflow-y-auto">
                    {unassigned.map((user) => {
                      const checked = selectedUserIds.includes(user.id);
                      return (
                        <li key={user.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-800/40">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleUserSelection(user.id)}
                              className="size-4 rounded border-zinc-600 bg-zinc-800 accent-violet-500"
                            />
                            <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                              {user.email}
                            </span>
                            <span className="shrink-0 text-xs text-zinc-500">{user.role}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setAssignPanelOpen(false);
                        setSelectedUserIds([]);
                      }}
                      className="rounded-xl px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={selectedUserIds.length === 0 || isAssigning}
                      onClick={() => void handleAssign()}
                      className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
                    >
                      {isAssigning && (
                        <div className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      )}
                      {selectedUserIds.length > 0
                        ? `Assign (${selectedUserIds.length})`
                        : "Assign"}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Assigned users list */}
        {isLoadingAgentUsers ? (
          <div className="flex h-20 items-center justify-center">
            <div className="size-5 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
          </div>
        ) : assignedUsers.length === 0 ? (
          <div className="flex h-20 flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800">
            <p className="text-sm text-zinc-600">No users assigned yet</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
            <div className="border-b border-zinc-800 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Assigned ({assignedUsers.length})
            </div>
            <ul className="divide-y divide-zinc-800">
              {assignedUsers.map((user) => (
                <li key={user.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-100">{user.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRemoveUserId(user.id)}
                    aria-label={`Remove ${user.email}`}
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-red-950/40 hover:text-red-400"
                  >
                    <UserX className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Edit modal — store updates agent automatically via agentFromStore */}
      {editOpen && (
        <AgentFormModal agent={agent} onClose={() => setEditOpen(false)} />
      )}

      {/* Deactivate confirm */}
      <ConfirmDialog
        open={deactivateOpen}
        title="Deactivate agent"
        description={`"${agent.name}" will be set to inactive and will no longer be available.`}
        confirmLabel="Deactivate"
        onConfirm={() => void handleDeactivate()}
        onCancel={() => setDeactivateOpen(false)}
      />

      {/* Delete document confirm */}
      <ConfirmDialog
        open={deleteDocFilename !== null}
        title="Delete document"
        description={`All chunks for "${deleteDocFilename ?? ""}" will be permanently removed from this agent's knowledge base.`}
        confirmLabel="Delete"
        onConfirm={() => void handleDeleteDoc()}
        onCancel={() => setDeleteDocFilename(null)}
      />

      {/* Remove user confirm */}
      <ConfirmDialog
        open={removeUserId !== null}
        title="Remove user"
        description={`Remove access for "${assignedUsers.find((u) => u.id === removeUserId)?.email ?? ""}"?`}
        confirmLabel="Remove"
        onConfirm={() => void handleRemoveUser()}
        onCancel={() => setRemoveUserId(null)}
      />
    </>
  );
}
