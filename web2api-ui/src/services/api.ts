const BASE = (import.meta.env.VITE_API_URL as string | undefined)
  ?.replace(/\/$/, '') ?? 'http://127.0.0.1:8000'

function authHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

export interface AuthResponse {
  success: boolean
  token: string
  email: string
}

export async function register(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw res
  return res.json()
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw res
  return res.json()
}

export async function getMe(token: string): Promise<{ email: string }> {
  const res = await fetch(`${BASE}/auth/me`, {
    headers: authHeaders(token),
  })
  if (!res.ok) throw res
  return res.json()
}

export async function getCookiesStatus(token: string): Promise<{ connected: boolean }> {
  const res = await fetch(`${BASE}/api/cookies/status`, {
    headers: authHeaders(token),
  })
  if (!res.ok) throw res
  return res.json()
}

export async function saveCookies(token: string, psid: string, psidts: string): Promise<void> {
  const res = await fetch(`${BASE}/api/cookies`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ psid, psidts }),
  })
  if (!res.ok) throw res
}

export async function chatStream(
  token: string,
  message: string,
  model: string,
): Promise<Response> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ message, model }),
  })
  if (!res.ok) throw res
  return res
}
