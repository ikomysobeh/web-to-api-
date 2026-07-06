import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, Lightbulb, Pencil, PowerOff, Sparkles, Trash2, Upload, UserPlus, UserX } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useAdminStore } from "@/stores/adminStore";
import { getAgent, listUsers } from "@/services/api";
import type { AdminUser } from "@/types/chat";
import { AgentFormModal } from "./AgentFormModal";
import { SuggestionsModal } from "./SuggestionsModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { gradientFor, initialsOf } from "@/lib/gradients";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";
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
    suggestionsByAgentId,
    isGeneratingSuggestions,
    loadSuggestions,
    generateSuggestions,
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
  const suggestions = suggestionsByAgentId[agentId ?? ""] ?? [];
  const [suggestionsModalOpen, setSuggestionsModalOpen] = useState(false);
  const [suggestionSeed, setSuggestionSeed] = useState<string[]>([]);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [assignPanelOpen, setAssignPanelOpen] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [removeUserId, setRemoveUserId] = useState<number | null>(null);

  // Paginated user list for assign panel
  const [availableUsers, setAvailableUsers] = useState<AdminUser[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [userLastPage, setUserLastPage] = useState(1);
  const [isLoadingAvailable, setIsLoadingAvailable] = useState(false);

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
    void loadSuggestions(agentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, token]);

  useEffect(() => {
    if (!assignPanelOpen || !token) return;
    setIsLoadingAvailable(true);
    listUsers(token, userPage, 10)
      .then((data) => {
        setAvailableUsers(data.users);
        setUserLastPage(data.lastPage);
      })
      .finally(() => setIsLoadingAvailable(false));
  }, [assignPanelOpen, userPage, token]);

  async function handleFile(file: File) {
    if (!agentId) return;
    setUploadFeedback(null);
    try {
      await uploadDocument(agentId, file);
      setUploadFeedback({ type: "success", message: `"${file.name}" uploaded successfully` });
    } catch (err) {
      setUploadFeedback({ type: "error", message: await getErrorMessage(err, "Upload failed. Please try again.") });
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

  async function handleGenerateSuggestions() {
    if (!agentId) return;
    setSuggestionError(null);
    try {
      const questions = await generateSuggestions(agentId);
      setSuggestionSeed(questions);
      setSuggestionsModalOpen(true);
    } catch (err) {
      setSuggestionError(await getErrorMessage(err, "Could not generate suggestions. Please try again."));
    }
  }

  function handleEditSuggestions() {
    setSuggestionError(null);
    setSuggestionSeed(suggestions.map((s) => s.question));
    setSuggestionsModalOpen(true);
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
    <div>
      {/* Back link + actions band */}
      <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 sm:px-8">
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
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-zinc-100 active:scale-[0.98]"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
          {agent.is_active && (
            <button
              type="button"
              onClick={() => setDeactivateOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-red-400/20 px-3 py-1.5 text-sm text-red-300 transition-colors hover:bg-red-500/10 active:scale-[0.98]"
            >
              <PowerOff className="size-3.5" />
              Deactivate
            </button>
          )}
        </div>
      </div>

      <div className="px-6 py-7 sm:px-8">
      {/* Agent info — flat */}
      <div className="mb-8 border-b border-white/5 pb-8">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div
              className={cn(
                "flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-lg font-bold text-white",
                gradientFor(agent.id),
              )}
            >
              {initialsOf(agent.name)}
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-zinc-100">{agent.name}</h2>
              {agent.description && (
                <p className="mt-1 text-sm text-zinc-400">{agent.description}</p>
              )}
            </div>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
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
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
          <span>
            Model:{" "}
            <span className="nums font-mono text-zinc-400">
              {agent.model}
            </span>
          </span>
          <span>
            Updated:{" "}
            <span className="nums text-zinc-400">
              {new Date(agent.updated_at).toLocaleDateString()}
            </span>
          </span>
        </div>

        {agent.instructions && (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Instructions
            </p>
            <pre className="whitespace-pre-wrap rounded-xl bg-white/[0.03] px-4 py-3 font-sans text-xs leading-relaxed text-zinc-300 ring-1 ring-inset ring-white/5">
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
              ? "cursor-default border-violet-400/40 bg-violet-500/10"
              : "border-white/10 hover:border-violet-400/30 hover:bg-white/5",
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
              "mb-4 rounded-xl px-4 py-3 text-sm ring-1 ring-inset",
              uploadFeedback.type === "success"
                ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
                : "bg-red-500/10 text-red-300 ring-red-400/20",
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
          <div className="flex h-20 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10">
            <p className="text-sm text-zinc-600">No documents yet — upload your first file above</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/5">
            <div className="border-b border-white/5 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Documents ({docs.length})
            </div>
            <ul className="divide-y divide-white/5">
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
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-red-500/20 hover:text-red-300"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Suggestions */}
      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-100">Suggestions</h3>
          <div className="flex items-center gap-2">
            {suggestions.length > 0 && (
              <button
                type="button"
                onClick={handleEditSuggestions}
                className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-zinc-100 active:scale-[0.98]"
              >
                <Pencil className="size-3.5" />
                Edit
              </button>
            )}
            <button
              type="button"
              disabled={isGeneratingSuggestions}
              onClick={() => void handleGenerateSuggestions()}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-violet-950/50 transition-all hover:shadow-violet-900/60 active:scale-[0.98] disabled:opacity-50"
            >
              {isGeneratingSuggestions ? (
                <>
                  <div className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  Generate Suggestions
                </>
              )}
            </button>
          </div>
        </div>

        <p className="mb-4 text-xs text-zinc-500">
          Starter questions shown to users of this agent. Generated from its documents by Gemini, then
          reviewed and approved by you.
        </p>

        {suggestionError && (
          <div className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-inset ring-red-400/20">
            {suggestionError}
          </div>
        )}

        {suggestions.length === 0 ? (
          <div className="flex h-20 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10">
            <p className="text-sm text-zinc-600">
              No suggestions yet — click "Generate Suggestions" to create some
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/5">
            <div className="border-b border-white/5 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Suggestions ({suggestions.length})
            </div>
            <ul className="divide-y divide-white/5">
              {suggestions.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <Lightbulb className="size-4 shrink-0 text-zinc-500" />
                  <p className="min-w-0 flex-1 text-sm text-zinc-200">{s.question}</p>
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
              setUserPage(1);
            }}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 backdrop-blur-sm transition-all hover:bg-white/10 hover:text-zinc-100 active:scale-[0.98]"
          >
            <UserPlus className="size-3.5" />
            Add users
          </button>
        </div>

        {/* Assign panel */}
        {assignPanelOpen && (
          <div className="mb-4 overflow-hidden rounded-xl border border-white/5">
            <div className="border-b border-white/5 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Select users to assign
            </div>
            {isLoadingAvailable ? (
              <div className="flex h-20 items-center justify-center">
                <div className="size-4 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
              </div>
            ) : (
              <>
                <ul className="divide-y divide-white/5">
                  {availableUsers.map((user) => {
                    const alreadyAssigned = assignedUsers.some((a) => a.id === user.id);
                    const checked = selectedUserIds.includes(user.id);
                    return (
                      <li key={user.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/5",
                            alreadyAssigned && "pointer-events-none opacity-40",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={alreadyAssigned}
                            onChange={() => toggleUserSelection(user.id)}
                            className="size-4 rounded border-white/20 bg-white/10 accent-violet-500"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                            {user.email}
                          </span>
                          <span className="shrink-0 text-xs text-zinc-500">
                            {alreadyAssigned ? "assigned" : user.role}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>

                {/* Page controls */}
                {userLastPage > 1 && (
                  <div className="flex items-center justify-between border-t border-white/5 px-4 py-2">
                    <span className="text-xs text-zinc-600">Page {userPage} / {userLastPage}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={userPage <= 1}
                        onClick={() => setUserPage((p) => p - 1)}
                        className="flex size-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/10 disabled:opacity-30"
                      >
                        <ChevronLeft className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={userPage >= userLastPage}
                        onClick={() => setUserPage((p) => p + 1)}
                        className="flex size-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/10 disabled:opacity-30"
                      >
                        <ChevronRight className="size-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 border-t border-white/5 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      setAssignPanelOpen(false);
                      setSelectedUserIds([]);
                      setUserPage(1);
                    }}
                    className="rounded-xl px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={selectedUserIds.length === 0 || isAssigning}
                    onClick={() => void handleAssign()}
                    className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-violet-950/50 transition-all hover:shadow-violet-900/60 active:scale-[0.98] disabled:opacity-50"
                  >
                    {isAssigning && (
                      <div className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    )}
                    {selectedUserIds.length > 0 ? `Assign (${selectedUserIds.length})` : "Assign"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Assigned users list */}
        {isLoadingAgentUsers ? (
          <div className="flex h-20 items-center justify-center">
            <div className="size-5 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
          </div>
        ) : assignedUsers.length === 0 ? (
          <div className="flex h-20 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10">
            <p className="text-sm text-zinc-600">No users assigned yet</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/5">
            <div className="border-b border-white/5 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Assigned ({assignedUsers.length})
            </div>
            <ul className="divide-y divide-white/5">
              {assignedUsers.map((user) => (
                <li key={user.id} className="flex items-center gap-3 px-4 py-3">
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-[10px] font-bold text-white",
                      gradientFor(user.email),
                    )}
                  >
                    {initialsOf(user.email)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-100">{user.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRemoveUserId(user.id)}
                    aria-label={`Remove ${user.email}`}
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-red-500/20 hover:text-red-300"
                  >
                    <UserX className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      </div>

      {/* Edit modal — store updates agent automatically via agentFromStore */}
      {editOpen && (
        <AgentFormModal agent={agent} onClose={() => setEditOpen(false)} />
      )}

      {/* Suggestions review modal */}
      {suggestionsModalOpen && agentId && (
        <SuggestionsModal
          agentId={agentId}
          agentName={agent.name}
          initialQuestions={suggestionSeed}
          onClose={() => setSuggestionsModalOpen(false)}
        />
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
    </div>
  );
}
