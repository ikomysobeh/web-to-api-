// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus = "sending" | "streaming" | "done" | "error";

// ---------------------------------------------------------------------------
// ChatMessage  (used in UI / store)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: MessageRole;
  /** Plain text or markdown content */
  content: string;
  createdAt: Date;
  status: MessageStatus;
}

// ---------------------------------------------------------------------------
// AIModel
// ---------------------------------------------------------------------------

export type AIModelId = string;

export interface AIModel {
  id: AIModelId;
  name: string;
  description: string;
  contextWindow: string;
  badge?: string;
}

/** Model as returned by GET /api/models */
export interface ApiModel {
  id: string;
  name: string;
  description: string;
  contextWindow: string;
  badge: string;
  available: boolean;
}

/** User profile as returned by GET /api/user/profile */
export interface ApiUserProfile {
  user_id: number;
  email: string;
  created_at: string;
  last_login: string | null;
  preferences: {
    default_model: string;
    theme: "dark" | "light";
  };
}

// ---------------------------------------------------------------------------
// ChatSession  (UI shape — still used by ChatMessages component)
// ---------------------------------------------------------------------------

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  modelId: AIModelId;
  createdAt: Date;
  updatedAt: Date;
  pinned?: boolean;
}

// ---------------------------------------------------------------------------
// SuggestionPrompt
// ---------------------------------------------------------------------------

export interface SuggestionPrompt {
  id: string;
  /** Lucide icon component name e.g. "Code2" */
  icon: string;
  title: string;
  prompt: string;
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

export interface ChatState {
  sessions: ChatSession[];
  activeChatId: string | null;
  sidebarOpen: boolean;
  selectedModelId: AIModelId;
}

// ---------------------------------------------------------------------------
// API response types  (from webai-bridge backend)
// ---------------------------------------------------------------------------

export interface ApiConversation {
  id: string;           // UUID
  user_id: number;
  title: string;
  model: string;        // e.g. "gemini-3-flash"
  message_count: number;
  created_at: string;   // ISO 8601
  updated_at: string;
}

export interface ApiMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Mapper: backend message → UI ChatMessage
// ---------------------------------------------------------------------------

export function apiMsgToChat(m: ApiMessage): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: new Date(m.created_at),
    status: "done",
  };
}
