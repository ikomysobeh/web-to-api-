import type { AdminUser, Agent, AgentCreate, AgentDocument, AgentUpdate, AgentUser, ApiConversation, ApiMessage, ApiModel, ApiUserProfile, UserAgent } from "@/types/chat";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)
  ?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

const EXT_BASE = "https://authtesting.lcportal.cloud/api/v1";

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

function getOrCreateDeviceId(): string {
  const key = "lc_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(key, id);
  }
  return id;
}

// Unwrap a response that may or may not be nested under a "data" key.
function unwrap(raw: Record<string, unknown>): Record<string, unknown> {
  const nested = raw.data;
  return (nested && typeof nested === "object" && !Array.isArray(nested))
    ? (nested as Record<string, unknown>)
    : raw;
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const res = await fetch(`${EXT_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      email,
      password,
      client_type: "web",
      device: {
        app_version: "1.0.0",
        device_id: getOrCreateDeviceId(),
        model: "Browser",
        os_version: typeof navigator !== "undefined" ? navigator.platform : "web",
        platform: "web",
      },
    }),
  });
  if (!res.ok) throw res;
  const raw = await res.json() as Record<string, unknown>;
  const d = unwrap(raw);
  const token = (d.access_token ?? d.token ?? "") as string;
  const userObj = d.user as Record<string, unknown> | undefined;
  const resolvedEmail = (userObj?.email ?? d.email ?? email) as string;
  return { success: true, token, email: resolvedEmail };
}

export async function getMe(token: string): Promise<{ email: string }> {
  const res = await fetch(`${EXT_BASE}/auth/me`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
  const raw = await res.json() as Record<string, unknown>;
  const d = unwrap(raw);
  const userObj = d.user as Record<string, unknown> | undefined;
  return { email: (userObj?.email ?? d.email ?? "") as string };
}

export async function postLogout(token: string): Promise<void> {
  await fetch(`${EXT_BASE}/auth/logout`, {
    method: "POST",
    headers: authHeaders(token),
  });
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
  agentId?: string,
): Promise<Response> {
  const body: Record<string, string> = { message, model };
  if (agentId) body.agent_id = agentId;
  const res = await fetch(
    `${BASE}/api/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
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

// ---------------------------------------------------------------------------
// Admin — Auth check
// ---------------------------------------------------------------------------

export async function checkAdmin(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${EXT_BASE}/auth/me`, {
      headers: authHeaders(token),
    });
    if (!res.ok) return false;
    const raw = await res.json() as Record<string, unknown>;
    const d = unwrap(raw);
    const userObj = d.user as Record<string, unknown> | undefined;
    const role = (userObj?.role ?? d.role ?? "") as string;
    return role.toLowerCase() === "admin";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Admin — Agents
// ---------------------------------------------------------------------------

export async function listAgents(token: string): Promise<{ agents: Agent[] }> {
  const res = await fetch(`${BASE}/admin/agents`, { headers: authHeaders(token) });
  if (!res.ok) throw res;
  return res.json();
}

export async function createAgent(
  token: string,
  data: AgentCreate,
): Promise<{ agent: Agent }> {
  const res = await fetch(`${BASE}/admin/agents`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw res;
  return res.json();
}

export async function getAgent(token: string, id: string): Promise<{ agent: Agent }> {
  const res = await fetch(`${BASE}/admin/agents/${id}`, { headers: authHeaders(token) });
  if (!res.ok) throw res;
  return res.json();
}

export async function updateAgent(
  token: string,
  id: string,
  data: AgentUpdate,
): Promise<{ agent: Agent }> {
  const res = await fetch(`${BASE}/admin/agents/${id}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw res;
  return res.json();
}

export async function deactivateAgent(
  token: string,
  id: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BASE}/admin/agents/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
  return res.json();
}

// ---------------------------------------------------------------------------
// Admin — Documents
// ---------------------------------------------------------------------------

export async function listAgentDocuments(
  token: string,
  agentId: string,
): Promise<{ documents: AgentDocument[] }> {
  const res = await fetch(`${BASE}/admin/agents/${agentId}/documents`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
  return res.json();
}

export async function uploadAgentDocument(
  token: string,
  agentId: string,
  file: File,
): Promise<{ success: boolean; message: string; filename: string; chunks: number }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/admin/agents/${agentId}/documents`, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw res;
  return res.json();
}

export async function deleteAgentDocument(
  token: string,
  agentId: string,
  filename: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(
    `${BASE}/admin/agents/${agentId}/documents/${encodeURIComponent(filename)}`,
    { method: "DELETE", headers: authHeaders(token) },
  );
  if (!res.ok) throw res;
  return res.json();
}

// ---------------------------------------------------------------------------
// Admin — Users
// ---------------------------------------------------------------------------

export async function listUsers(token: string): Promise<{ users: AdminUser[] }> {
  const res = await fetch(`${EXT_BASE}/users`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
  const data = await res.json() as { data: AdminUser[] };
  return { users: data.data };
}

// ---------------------------------------------------------------------------
// Admin — Agent User Assignments
// ---------------------------------------------------------------------------

export async function getAgentUsers(
  token: string,
  agentId: string,
): Promise<{ users: AgentUser[] }> {
  const res = await fetch(`${BASE}/admin/agents/${agentId}/users`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
  return res.json();
}

export async function assignAgentUsers(
  token: string,
  agentId: string,
  userIds: number[],
): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/admin/agents/${agentId}/users`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ user_ids: userIds }),
  });
  if (!res.ok) throw res;
  return res.json();
}

export async function removeAgentUser(
  token: string,
  agentId: string,
  userId: number,
): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/admin/agents/${agentId}/users/${userId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
  return res.json();
}

// ---------------------------------------------------------------------------
// User — Agents (user-facing)
// ---------------------------------------------------------------------------

export async function listMyAgents(token: string): Promise<{ agents: UserAgent[] }> {
  const res = await fetch(`${BASE}/api/agents`, { headers: authHeaders(token) });
  if (!res.ok) throw res;
  return res.json();
}

export async function getMyAgent(
  token: string,
  agentId: string,
): Promise<{ agent: UserAgent }> {
  const res = await fetch(`${BASE}/api/agents/${agentId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw res;
  return res.json();
}
