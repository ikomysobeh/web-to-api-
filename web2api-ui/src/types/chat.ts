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
// Admin — Agent types
// ---------------------------------------------------------------------------

export interface Agent {
  id: string;
  name: string;
  description: string;
  model: string;
  instructions: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentCreate {
  name: string;
  description?: string;
  model?: string;
  instructions: string;
}

export type AgentUpdate = Partial<AgentCreate> & { is_active?: boolean };

export interface AgentDocument {
  filename: string;
  chunk_count: number;
}

export interface Suggestion {
  id: string;
  question: string;
  sort_order?: number;
}

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

export interface AgentUser {
  id: number;
  email: string;
}

export interface UserAgent {
  id: string;
  name: string;
  description: string;
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
