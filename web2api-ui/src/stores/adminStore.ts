import { create } from "zustand";
import type { AdminUser, Agent, AgentCreate, AgentDocument, AgentUpdate, AgentUser, Suggestion } from "@/types/chat";
import {
  listAgents,
  createAgent as apiCreateAgent,
  updateAgent as apiUpdateAgent,
  deactivateAgent as apiDeactivateAgent,
  listAgentDocuments,
  uploadAgentDocument as apiUploadAgentDocument,
  deleteAgentDocument as apiDeleteAgentDocument,
  listUsers as apiListUsers,
  getAgentUsers as apiGetAgentUsers,
  assignAgentUsers as apiAssignAgentUsers,
  removeAgentUser as apiRemoveAgentUser,
  generateAgentSuggestions as apiGenerateSuggestions,
  getAgentSuggestions as apiGetSuggestions,
  saveAgentSuggestions as apiSaveSuggestions,
} from "@/services/api";

function getToken(): string {
  return localStorage.getItem("auth_token") ?? "";
}

interface AdminStore {
  agents: Agent[];
  isLoadingAgents: boolean;
  isSaving: boolean;
  documentsByAgentId: Record<string, AgentDocument[]>;
  isLoadingDocs: boolean;
  isUploading: boolean;
  users: AdminUser[];
  isLoadingUsers: boolean;
  usersPagination: { total: number; lastPage: number; currentPage: number };
  assignedUsersByAgentId: Record<string, AgentUser[]>;
  isLoadingAgentUsers: boolean;
  isAssigning: boolean;
  suggestionsByAgentId: Record<string, Suggestion[]>;
  isGeneratingSuggestions: boolean;
  isSavingSuggestions: boolean;
  loadAgents: () => Promise<void>;
  createAgent: (data: AgentCreate) => Promise<Agent>;
  updateAgent: (id: string, data: AgentUpdate) => Promise<void>;
  deactivateAgent: (id: string) => Promise<void>;
  loadDocuments: (agentId: string) => Promise<void>;
  uploadDocument: (agentId: string, file: File) => Promise<void>;
  deleteDocument: (agentId: string, filename: string) => Promise<void>;
  loadUsers: (page?: number) => Promise<void>;
  loadAgentUsers: (agentId: string) => Promise<void>;
  assignAgentUsers: (agentId: string, userIds: number[]) => Promise<void>;
  removeAgentUser: (agentId: string, userId: number) => Promise<void>;
  loadSuggestions: (agentId: string) => Promise<void>;
  generateSuggestions: (agentId: string, count?: number) => Promise<string[]>;
  saveSuggestions: (agentId: string, questions: string[]) => Promise<void>;
}

const initialState = {
  agents: [] as Agent[],
  isLoadingAgents: false,
  isSaving: false,
  documentsByAgentId: {} as Record<string, AgentDocument[]>,
  isLoadingDocs: false,
  isUploading: false,
  users: [] as AdminUser[],
  isLoadingUsers: false,
  usersPagination: { total: 0, lastPage: 1, currentPage: 1 },
  assignedUsersByAgentId: {} as Record<string, AgentUser[]>,
  isLoadingAgentUsers: false,
  isAssigning: false,
  suggestionsByAgentId: {} as Record<string, Suggestion[]>,
  isGeneratingSuggestions: false,
  isSavingSuggestions: false,
};

export const useAdminStore = create<AdminStore>((set) => ({
  ...initialState,

  loadAgents: async () => {
    const token = getToken();
    if (!token) return;
    set({ isLoadingAgents: true });
    try {
      const data = await listAgents(token);
      set({ agents: data.agents, isLoadingAgents: false });
    } catch {
      set({ isLoadingAgents: false });
    }
  },

  createAgent: async (data: AgentCreate): Promise<Agent> => {
    const token = getToken();
    set({ isSaving: true });
    try {
      const res = await apiCreateAgent(token, data);
      set((state) => ({
        agents: [res.agent, ...state.agents],
        isSaving: false,
      }));
      return res.agent;
    } catch (err) {
      set({ isSaving: false });
      throw err;
    }
  },

  updateAgent: async (id: string, data: AgentUpdate) => {
    const token = getToken();
    set({ isSaving: true });
    try {
      const res = await apiUpdateAgent(token, id, data);
      set((state) => ({
        agents: state.agents.map((a) => (a.id === id ? res.agent : a)),
        isSaving: false,
      }));
    } catch (err) {
      set({ isSaving: false });
      throw err;
    }
  },

  deactivateAgent: async (id: string) => {
    const token = getToken();
    await apiDeactivateAgent(token, id);
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === id ? { ...a, is_active: false } : a,
      ),
    }));
  },

  loadDocuments: async (agentId: string) => {
    const token = getToken();
    if (!token) return;
    set({ isLoadingDocs: true });
    try {
      const data = await listAgentDocuments(token, agentId);
      set((state) => ({
        documentsByAgentId: { ...state.documentsByAgentId, [agentId]: data.documents },
        isLoadingDocs: false,
      }));
    } catch {
      set({ isLoadingDocs: false });
    }
  },

  uploadDocument: async (agentId: string, file: File) => {
    const token = getToken();
    set({ isUploading: true });
    try {
      const res = await apiUploadAgentDocument(token, agentId, file);
      set((state) => ({
        documentsByAgentId: {
          ...state.documentsByAgentId,
          [agentId]: [
            ...(state.documentsByAgentId[agentId] ?? []),
            { filename: res.filename, chunk_count: res.chunks },
          ],
        },
        isUploading: false,
      }));
    } catch (err) {
      set({ isUploading: false });
      throw err;
    }
  },

  deleteDocument: async (agentId: string, filename: string) => {
    const token = getToken();
    await apiDeleteAgentDocument(token, agentId, filename);
    set((state) => ({
      documentsByAgentId: {
        ...state.documentsByAgentId,
        [agentId]: (state.documentsByAgentId[agentId] ?? []).filter(
          (d) => d.filename !== filename,
        ),
      },
    }));
  },

  loadUsers: async (page = 1) => {
    const token = getToken();
    if (!token) return;
    set({ isLoadingUsers: true });
    try {
      const data = await apiListUsers(token, page);
      set({
        users: data.users,
        isLoadingUsers: false,
        usersPagination: { total: data.total, lastPage: data.lastPage, currentPage: data.currentPage },
      });
    } catch {
      set({ isLoadingUsers: false });
    }
  },

  loadAgentUsers: async (agentId: string) => {
    const token = getToken();
    if (!token) return;
    set({ isLoadingAgentUsers: true });
    try {
      const data = await apiGetAgentUsers(token, agentId);
      set((state) => ({
        assignedUsersByAgentId: { ...state.assignedUsersByAgentId, [agentId]: data.users },
        isLoadingAgentUsers: false,
      }));
    } catch {
      set({ isLoadingAgentUsers: false });
    }
  },

  assignAgentUsers: async (agentId: string, userIds: number[]) => {
    const token = getToken();
    set({ isAssigning: true });
    try {
      await apiAssignAgentUsers(token, agentId, userIds);
      const data = await apiGetAgentUsers(token, agentId);
      set((state) => ({
        assignedUsersByAgentId: { ...state.assignedUsersByAgentId, [agentId]: data.users },
        isAssigning: false,
      }));
    } catch (err) {
      set({ isAssigning: false });
      throw err;
    }
  },

  removeAgentUser: async (agentId: string, userId: number) => {
    const token = getToken();
    await apiRemoveAgentUser(token, agentId, userId);
    set((state) => ({
      assignedUsersByAgentId: {
        ...state.assignedUsersByAgentId,
        [agentId]: (state.assignedUsersByAgentId[agentId] ?? []).filter(
          (u) => u.id !== userId,
        ),
      },
    }));
  },

  loadSuggestions: async (agentId: string) => {
    const token = getToken();
    if (!token) return;
    try {
      const data = await apiGetSuggestions(token, agentId);
      set((state) => ({
        suggestionsByAgentId: { ...state.suggestionsByAgentId, [agentId]: data.suggestions },
      }));
    } catch {
      // leave existing suggestions in place on failure
    }
  },

  // Returns the generated (unsaved) questions so the modal can seed itself.
  generateSuggestions: async (agentId: string, count = 6): Promise<string[]> => {
    const token = getToken();
    set({ isGeneratingSuggestions: true });
    try {
      const data = await apiGenerateSuggestions(token, agentId, count);
      set({ isGeneratingSuggestions: false });
      return data.questions;
    } catch (err) {
      set({ isGeneratingSuggestions: false });
      throw err;
    }
  },

  saveSuggestions: async (agentId: string, questions: string[]) => {
    const token = getToken();
    set({ isSavingSuggestions: true });
    try {
      await apiSaveSuggestions(token, agentId, questions);
      const data = await apiGetSuggestions(token, agentId);
      set((state) => ({
        suggestionsByAgentId: { ...state.suggestionsByAgentId, [agentId]: data.suggestions },
        isSavingSuggestions: false,
      }));
    } catch (err) {
      set({ isSavingSuggestions: false });
      throw err;
    }
  },
}));
