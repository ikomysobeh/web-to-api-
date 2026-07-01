import { create } from "zustand";
import type { EmbedConfig, EmbedCreate, EmbedUpdate } from "@/types/chat";
import {
  listEmbeds,
  createEmbed as apiCreateEmbed,
  updateEmbed as apiUpdateEmbed,
  deleteEmbed as apiDeleteEmbed,
} from "@/services/api";

function getToken(): string {
  return localStorage.getItem("auth_token") ?? "";
}

interface EmbedStore {
  embeds: EmbedConfig[];
  isLoading: boolean;
  isSaving: boolean;
  loadEmbeds: () => Promise<void>;
  createEmbed: (data: EmbedCreate) => Promise<EmbedConfig>;
  updateEmbed: (id: string, data: EmbedUpdate) => Promise<void>;
  deleteEmbed: (id: string) => Promise<void>;
}

export const useEmbedStore = create<EmbedStore>((set) => ({
  embeds: [],
  isLoading: false,
  isSaving: false,

  loadEmbeds: async () => {
    const token = getToken();
    if (!token) return;
    set({ isLoading: true });
    try {
      const data = await listEmbeds(token);
      set({ embeds: data.embeds, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  createEmbed: async (data: EmbedCreate): Promise<EmbedConfig> => {
    const token = getToken();
    set({ isSaving: true });
    try {
      const res = await apiCreateEmbed(token, data);
      set((state) => ({ embeds: [res.embed, ...state.embeds], isSaving: false }));
      return res.embed;
    } catch (err) {
      set({ isSaving: false });
      throw err;
    }
  },

  updateEmbed: async (id: string, data: EmbedUpdate) => {
    const token = getToken();
    set({ isSaving: true });
    try {
      const res = await apiUpdateEmbed(token, id, data);
      set((state) => ({
        embeds: state.embeds.map((e) => (e.id === id ? res.embed : e)),
        isSaving: false,
      }));
    } catch (err) {
      set({ isSaving: false });
      throw err;
    }
  },

  deleteEmbed: async (id: string) => {
    const token = getToken();
    await apiDeleteEmbed(token, id);
    set((state) => ({
      embeds: state.embeds.map((e) => (e.id === id ? { ...e, is_active: false } : e)),
    }));
  },
}));
