import { create } from "zustand";

import type { AIModelId, ApiConversation, ApiModel, ChatMessage, UserAgent } from "@/types/chat";
import { apiMsgToChat } from "@/types/chat";
import {
  getConversations,
  createConversation,
  getConversation,
  updateConversation,
  deleteConversation as apiDeleteConversation,
  deleteAllConversations as apiDeleteAllConversations,
  sendConversationMessage,
  getConversationMessages,
  deleteConversationMessage,
  getModels,
  getCookiesStatus,
  listMyAgents,
} from "@/services/api";
import { getErrorMessage, isGeminiAuthError } from "@/lib/errors";

const GEMINI_EXPIRED_MSG =
  "Your Gemini connection has expired. Please reconnect Gemini to keep chatting.";

// Default fallback model until /api/models is loaded
const DEFAULT_MODEL = "gemini-3-flash";

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export interface ConversationStore {
  // ── Data ──────────────────────────────────────────────────────────────────
  conversations: ApiConversation[];
  activeConversationId: string | null;
  messagesByConvId: Record<string, ChatMessage[]>;
  messagesTotalByConvId: Record<string, number>;
  messagesOffsetByConvId: Record<string, number>;
  /** Available models from GET /api/models */
  availableModels: ApiModel[];
  /** Agents the current user is assigned to */
  myAgents: UserAgent[];
  isLoadingMyAgents: boolean;
  selectedAgentId: string | null;

  // ── UI ────────────────────────────────────────────────────────────────────
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  selectedModelId: AIModelId;
  showCookieModal: boolean;

  // ── Loading ───────────────────────────────────────────────────────────────
  isLoadingConversations: boolean;
  streamingConvId: string | null;
  isLoadingMoreMessages: boolean;

  // ── Actions ───────────────────────────────────────────────────────────────
  loadConversations: () => Promise<void>;
  /** Load available models from API and update selectedModelId if needed */
  loadModels: () => Promise<void>;
  loadMyAgents: () => Promise<void>;
  setSelectedAgentId: (id: string | null) => void;
  checkCookies: () => Promise<void>;
  createAndSelectConversation: (firstMessage: string) => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  newChat: () => void;
  sendMessage: (content: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  deleteAllConversations: () => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  /** Load an older page of messages and prepend them */
  loadMoreMessages: (conversationId: string) => Promise<void>;
  /** Optimistically delete one message, restore on API error */
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;

  // ── UI setters ────────────────────────────────────────────────────────────
  setSidebarCollapsed: (v: boolean) => void;
  setMobileSidebarOpen: (v: boolean) => void;
  setSelectedModelId: (id: AIModelId) => void;
  setShowCookieModal: (v: boolean) => void;
  resetForLogout: () => void;
}

// ---------------------------------------------------------------------------
// Initial state values (reused in resetForLogout)
// ---------------------------------------------------------------------------

const initialState = {
  conversations: [] as ApiConversation[],
  activeConversationId: null as string | null,
  messagesByConvId: {} as Record<string, ChatMessage[]>,
  messagesTotalByConvId: {} as Record<string, number>,
  messagesOffsetByConvId: {} as Record<string, number>,
  availableModels: [] as ApiModel[],
  myAgents: [] as UserAgent[],
  isLoadingMyAgents: false,
  selectedAgentId: null as string | null,
  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  selectedModelId: DEFAULT_MODEL as AIModelId,
  showCookieModal: false,
  isLoadingConversations: false,
  streamingConvId: null as string | null,
  isLoadingMoreMessages: false,
};

// ---------------------------------------------------------------------------
// Helper — get JWT from localStorage
// ---------------------------------------------------------------------------

function getToken(): string {
  return localStorage.getItem("auth_token") ?? "";
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useConversationStore = create<ConversationStore>((set, get) => ({
  ...initialState,

  // ── Load conversations ────────────────────────────────────────────────────

  loadConversations: async () => {
    const token = getToken();
    if (!token) return;
    set({ isLoadingConversations: true });
    try {
      const data = await getConversations(token);
      set({ conversations: data.conversations, isLoadingConversations: false });
    } catch {
      set({ isLoadingConversations: false });
    }
  },

  // ── Load models ───────────────────────────────────────────────────────────

  loadModels: async () => {
    const token = getToken();
    if (!token) return;
    try {
      const data = await getModels(token);
      set((state) => {
        // If current selectedModelId is the placeholder default and the API
        // returned models, switch to the first available model
        const firstAvailable = data.models.find((m) => m.available);
        const current = state.selectedModelId;
        const isDefault = current === DEFAULT_MODEL;
        const existsInList = data.models.some((m) => m.id === current);
        return {
          availableModels: data.models,
          selectedModelId:
            !existsInList && isDefault && firstAvailable
              ? firstAvailable.id
              : current,
        };
      });
    } catch {
      // keep static fallback
    }
  },

  // ── Check cookies ─────────────────────────────────────────────────────────

  checkCookies: async () => {
    const token = getToken();
    if (!token) return;
    try {
      const data = await getCookiesStatus(token);
      if (!data.connected) set({ showCookieModal: true });
    } catch {
      set({ showCookieModal: true });
    }
  },

  // ── Create + select ───────────────────────────────────────────────────────

  createAndSelectConversation: async (firstMessage: string) => {
    const token = getToken();
    const { selectedModelId, selectedAgentId } = get();
    const backendModel = selectedModelId;

    const data = await createConversation(
      token,
      firstMessage.slice(0, 40).trim(),
      backendModel,
      selectedAgentId,   // bind the chosen agent to the conversation
    );

    const newConv = data.conversation;
    set((state) => ({
      conversations: [newConv, ...state.conversations],
      activeConversationId: newConv.id,
      messagesByConvId: { ...state.messagesByConvId, [newConv.id]: [] },
      messagesTotalByConvId: { ...state.messagesTotalByConvId, [newConv.id]: 0 },
      messagesOffsetByConvId: { ...state.messagesOffsetByConvId, [newConv.id]: 0 },
    }));

    return newConv.id;
  },

  // ── Select (lazy-load messages) ───────────────────────────────────────────

  selectConversation: async (id: string) => {
    const token = getToken();
    set({ activeConversationId: id, mobileSidebarOpen: false });

    const already = get().messagesByConvId[id];
    if (already !== undefined) return;

    try {
      const data = await getConversation(token, id);
      const messages = data.messages.map(apiMsgToChat);
      set((state) => ({
        messagesByConvId: { ...state.messagesByConvId, [id]: messages },
        messagesTotalByConvId: {
          ...state.messagesTotalByConvId,
          [id]: data.conversation.message_count,
        },
        messagesOffsetByConvId: {
          ...state.messagesOffsetByConvId,
          [id]: messages.length,
        },
      }));
    } catch {
      // Messages stay undefined — will retry next time
    }
  },

  // ── New blank chat ────────────────────────────────────────────────────────

  newChat: () => {
    set({ activeConversationId: null, mobileSidebarOpen: false });
  },

  // ── Send message (streaming) ──────────────────────────────────────────────

  sendMessage: async (content: string) => {
    const token = getToken();
    const trimmed = content.trim();
    if (!trimmed || !token) return;

    const { selectedModelId, selectedAgentId } = get();
    const backendModel = selectedModelId;

    let convId = get().activeConversationId;
    if (!convId) {
      convId = await get().createAndSelectConversation(trimmed);
    }

    // Use the agent bound to THIS conversation (locked once chat started);
    // fall back to the global selection for a brand-new conversation.
    const activeConv = get().conversations.find((c) => c.id === convId);
    const agentForSend = activeConv?.agent_id ?? selectedAgentId ?? undefined;

    const userMsg: ChatMessage = {
      id: `opt-user-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: new Date(),
      status: "done",
    };
    const replyId = `opt-reply-${Date.now()}`;
    const pendingReply: ChatMessage = {
      id: replyId,
      role: "assistant",
      content: "",
      createdAt: new Date(),
      status: "streaming",
    };

    const appendMessages = (extra: ChatMessage[]) =>
      set((state) => ({
        messagesByConvId: {
          ...state.messagesByConvId,
          [convId!]: [...(state.messagesByConvId[convId!] ?? []), ...extra],
        },
        messagesTotalByConvId: {
          ...state.messagesTotalByConvId,
          [convId!]: (state.messagesTotalByConvId[convId!] ?? 0) + extra.length,
        },
        messagesOffsetByConvId: {
          ...state.messagesOffsetByConvId,
          [convId!]: (state.messagesOffsetByConvId[convId!] ?? 0) + extra.length,
        },
        streamingConvId: convId,
      }));

    const patchReply = (content: string, status?: ChatMessage["status"]) =>
      set((state) => ({
        messagesByConvId: {
          ...state.messagesByConvId,
          [convId!]: (state.messagesByConvId[convId!] ?? []).map((m) =>
            m.id === replyId
              ? { ...m, content, ...(status ? { status } : {}) }
              : m,
          ),
        },
      }));

    appendMessages([userMsg, pendingReply]);

    let fullContent = "";
    try {
      const res = await sendConversationMessage(token, convId, trimmed, backendModel, agentForSend);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          let chunk = "";
          try {
            const json = JSON.parse(data) as {
              choices?: { delta?: { content?: string } }[];
              content?: string;
              error?: string;
            };
            // Backend streams errors as {"error": "..."} — surface them instead
            // of silently ignoring them (the old bug that showed an empty bubble).
            if (json.error) {
              const gemini = isGeminiAuthError(json.error);
              patchReply(gemini ? GEMINI_EXPIRED_MSG : json.error, "error");
              set({ streamingConvId: null });
              if (gemini) get().setShowCookieModal(true);
              return;
            }
            chunk = json.choices?.[0]?.delta?.content ?? json.content ?? "";
          } catch {
            chunk = data;
          }

          if (chunk) {
            fullContent += chunk;
            patchReply(fullContent);
          }
        }
      }

      patchReply(fullContent, "done");
      set({ streamingConvId: null });
      void get().loadConversations();
    } catch (err) {
      const msg = await getErrorMessage(err);
      patchReply(fullContent || msg, "error");
      set({ streamingConvId: null });
      if (isGeminiAuthError(msg)) get().setShowCookieModal(true);
    }
  },

  // ── Load more messages (older page) ──────────────────────────────────────

  loadMoreMessages: async (conversationId: string) => {
    const token = getToken();
    const { messagesOffsetByConvId } = get();
    const offset = messagesOffsetByConvId[conversationId] ?? 0;

    set({ isLoadingMoreMessages: true });
    try {
      const data = await getConversationMessages(token, conversationId, 50, offset);
      const older = data.messages.map(apiMsgToChat);
      set((state) => ({
        messagesByConvId: {
          ...state.messagesByConvId,
          [conversationId]: [
            ...older,
            ...(state.messagesByConvId[conversationId] ?? []),
          ],
        },
        messagesTotalByConvId: {
          ...state.messagesTotalByConvId,
          [conversationId]: data.total,
        },
        messagesOffsetByConvId: {
          ...state.messagesOffsetByConvId,
          [conversationId]: offset + older.length,
        },
        isLoadingMoreMessages: false,
      }));
    } catch {
      set({ isLoadingMoreMessages: false });
    }
  },

  // ── Delete one message ────────────────────────────────────────────────────

  deleteMessage: async (conversationId: string, messageId: string) => {
    const token = getToken();
    const snapshot = get().messagesByConvId[conversationId] ?? [];

    // Optimistic remove
    set((state) => ({
      messagesByConvId: {
        ...state.messagesByConvId,
        [conversationId]: (state.messagesByConvId[conversationId] ?? []).filter(
          (m) => m.id !== messageId,
        ),
      },
      messagesTotalByConvId: {
        ...state.messagesTotalByConvId,
        [conversationId]: Math.max(
          0,
          (state.messagesTotalByConvId[conversationId] ?? 1) - 1,
        ),
      },
    }));

    try {
      await deleteConversationMessage(token, conversationId, messageId);
    } catch {
      // Restore original messages on failure
      set((state) => ({
        messagesByConvId: {
          ...state.messagesByConvId,
          [conversationId]: snapshot,
        },
        messagesTotalByConvId: {
          ...state.messagesTotalByConvId,
          [conversationId]: snapshot.length,
        },
      }));
    }
  },

  // ── Delete one conversation ───────────────────────────────────────────────

  deleteConversation: async (id: string) => {
    const token = getToken();
    try {
      await apiDeleteConversation(token, id);
    } catch {
      // Optimistic removal regardless
    }
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeConversationId:
        state.activeConversationId === id ? null : state.activeConversationId,
      messagesByConvId: Object.fromEntries(
        Object.entries(state.messagesByConvId).filter(([k]) => k !== id),
      ),
      messagesTotalByConvId: Object.fromEntries(
        Object.entries(state.messagesTotalByConvId).filter(([k]) => k !== id),
      ),
      messagesOffsetByConvId: Object.fromEntries(
        Object.entries(state.messagesOffsetByConvId).filter(([k]) => k !== id),
      ),
    }));
  },

  // ── Delete all ────────────────────────────────────────────────────────────

  deleteAllConversations: async () => {
    const token = getToken();
    try {
      await apiDeleteAllConversations(token);
    } catch {
      // fall through
    }
    set({
      conversations: [],
      activeConversationId: null,
      messagesByConvId: {},
      messagesTotalByConvId: {},
      messagesOffsetByConvId: {},
    });
  },

  // ── Rename ────────────────────────────────────────────────────────────────

  renameConversation: async (id: string, title: string) => {
    const token = getToken();
    try {
      const data = await updateConversation(token, id, { title });
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? data.conversation : c,
        ),
      }));
    } catch {
      // ignore
    }
  },

  // ── UI setters ────────────────────────────────────────────────────────────

  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setMobileSidebarOpen: (v) => set({ mobileSidebarOpen: v }),
  setSelectedModelId: (id) => set({ selectedModelId: id }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  setShowCookieModal: (v) => set({ showCookieModal: v }),

  loadMyAgents: async () => {
    const token = getToken();
    if (!token) return;
    set({ isLoadingMyAgents: true });
    try {
      const data = await listMyAgents(token);
      set({ myAgents: data.agents, isLoadingMyAgents: false });
    } catch {
      set({ isLoadingMyAgents: false });
    }
  },

  // ── Reset on logout ───────────────────────────────────────────────────────

  resetForLogout: () => set(initialState),
}));
