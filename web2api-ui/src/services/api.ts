import type { ApiConversation, ApiMessage, ApiModel, ApiUserProfile } from "@/types/chat";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)
  ?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

function authHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthResponse {
  success: boolean;
  token: string;
  email: string;
}

export async function register(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw res;
  return res.json();
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw res;
  return res.json();
}

export async function getMe(token: string): Promise<{ email: string }> {
  const res = await fetch(`${BASE}/auth/me`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
  return res.json();
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

export async function getCookiesStatus(
  token: string,
): Promise<{ connected: boolean }> {
  const res = await fetch(`${BASE}/api/cookies/status`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
  return res.json();
}

export async function saveCookies(
  token: string,
  psid: string,
  psidts: string,
): Promise<void> {
  const res = await fetch(`${BASE}/api/cookies`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ psid, psidts }),
  });
  if (!res.ok) throw res;
}

// ---------------------------------------------------------------------------
// Simple / stateless chat  (kept for fallback — not used with conversations)
// ---------------------------------------------------------------------------

export async function chatStream(
  token: string,
  message: string,
  model: string,
): Promise<Response> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ message, model }),
  });
  if (!res.ok) throw res;
  return res;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationsResponse {
  success: boolean;
  total: number;
  conversations: ApiConversation[];
}

export async function getConversations(
  token: string,
  limit = 50,
  offset = 0,
): Promise<ConversationsResponse> {
  const res = await fetch(
    `${BASE}/api/conversations?limit=${limit}&offset=${offset}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw res;
  return res.json();
}

export interface ConversationResponse {
  success: boolean;
  conversation: ApiConversation;
}

export async function createConversation(
  token: string,
  title?: string,
  model?: string,
): Promise<ConversationResponse> {
  const res = await fetch(`${BASE}/api/conversations`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      title: title ?? "New Conversation",
      model: model ?? "gemini-3-flash",
    }),
  });
  if (!res.ok) throw res;
  return res.json();
}

export interface ConversationDetailResponse {
  success: boolean;
  conversation: ApiConversation;
  messages: ApiMessage[];
}

export async function getConversation(
  token: string,
  id: string,
): Promise<ConversationDetailResponse> {
  const res = await fetch(`${BASE}/api/conversations/${id}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
  return res.json();
}

export async function updateConversation(
  token: string,
  id: string,
  data: { title?: string; model?: string },
): Promise<ConversationResponse> {
  const res = await fetch(`${BASE}/api/conversations/${id}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw res;
  return res.json();
}

export async function deleteConversation(
  token: string,
  id: string,
): Promise<void> {
  const res = await fetch(`${BASE}/api/conversations/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
}

export async function deleteAllConversations(token: string): Promise<void> {
  const res = await fetch(`${BASE}/api/conversations`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
}

export async function sendConversationMessage(
  token: string,
  conversationId: string,
  message: string,
  model: string,
): Promise<Response> {
  const res = await fetch(
    `${BASE}/api/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ message, model }),
    },
  );
  if (!res.ok) throw res;
  return res;
}

export interface MessagesResponse {
  success: boolean;
  total: number;
  messages: ApiMessage[];
}

export async function getConversationMessages(
  token: string,
  id: string,
  limit = 50,
  offset = 0,
): Promise<MessagesResponse> {
  const res = await fetch(
    `${BASE}/api/conversations/${id}/messages?limit=${limit}&offset=${offset}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw res;
  return res.json();
}

export async function deleteConversationMessage(
  token: string,
  conversationId: string,
  messageId: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(
    `${BASE}/api/conversations/${conversationId}/messages/${messageId}`,
    { method: "DELETE", headers: authHeaders(token) },
  );
  if (!res.ok) throw res;
  return res.json();
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export async function getModels(
  token: string,
): Promise<{ success: boolean; models: ApiModel[] }> {
  const res = await fetch(`${BASE}/api/models`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
  return res.json();
}

// ---------------------------------------------------------------------------
// User Profile
// ---------------------------------------------------------------------------

export async function getUserProfile(
  token: string,
): Promise<{ success: boolean; user: ApiUserProfile }> {
  const res = await fetch(`${BASE}/api/user/profile`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
  return res.json();
}

export async function updateUserProfile(
  token: string,
  data: { default_model?: string; theme?: "dark" | "light" },
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BASE}/api/user/profile`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw res;
  return res.json();
}

export async function postLogout(token: string): Promise<void> {
  await fetch(`${BASE}/api/user/logout`, {
    method: "POST",
    headers: authHeaders(token),
  });
  // fire-and-forget — server is stateless, always clear local state
}
