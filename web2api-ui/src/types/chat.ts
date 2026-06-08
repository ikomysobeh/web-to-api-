// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus = "sending" | "streaming" | "done" | "error";

// ---------------------------------------------------------------------------
// ChatMessage
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

export type AIModelId = "lumina-flash" | "lumina-pro" | "lumina-reasoning";

export interface AIModel {
  id: AIModelId;
  name: string;
  description: string;
  contextWindow: string;
  /** Short label shown as a badge in the UI */
  badge?: string;
}

// ---------------------------------------------------------------------------
// ChatSession
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
