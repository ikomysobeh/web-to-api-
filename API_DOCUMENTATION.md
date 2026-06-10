# API Documentation — WebAI Bridge

> **Base URL:** `http://localhost:8000`
> **Content-Type:** `application/json` for all requests and responses
> **Auth:** Bearer token in the `Authorization` header → `Authorization: Bearer <token>`

---

## Quick Reference

| # | Method | Endpoint | Auth | Description |
|---|--------|----------|------|-------------|
| 1 | GET | `/health` | ❌ | Health check |
| 2 | POST | `/auth/register` | ❌ | Register new account |
| 3 | POST | `/auth/login` | ❌ | Login, get token |
| 4 | GET | `/auth/me` | ✅ | Get current user |
| 5 | POST | `/api/cookies` | ✅ | Save Gemini cookies manually |
| 6 | POST | `/api/cookies/extract` | ✅ | Auto-extract cookies from browser |
| 7 | GET | `/api/cookies/status` | ✅ | Check Gemini connection |
| 8 | DELETE | `/api/cookies` | ✅ | Disconnect Gemini |
| 9 | POST | `/api/chat` | ✅ | Stream a single chat message |
| 10 | GET | `/api/conversations` | ✅ | List all conversations |
| 11 | POST | `/api/conversations` | ✅ | Create new conversation |
| 12 | GET | `/api/conversations/{id}` | ✅ | Get conversation + messages |
| 13 | PUT | `/api/conversations/{id}` | ✅ | Update conversation |
| 14 | DELETE | `/api/conversations/{id}` | ✅ | Delete one conversation |
| 15 | DELETE | `/api/conversations` | ✅ | Delete all conversations |
| 16 | POST | `/api/conversations/{id}/messages` | ✅ | Send message (streaming) |
| 17 | GET | `/api/conversations/{id}/messages` | ✅ | List messages |
| 18 | DELETE | `/api/conversations/{id}/messages/{msg_id}` | ✅ | Delete a message |
| 19 | GET | `/api/models` | ✅ | List available models |
| 20 | GET | `/api/user/profile` | ✅ | Get profile + preferences |
| 21 | PUT | `/api/user/profile` | ✅ | Update preferences |
| 22 | POST | `/api/user/logout` | ✅ | Logout |
| 23 | GET | `/api/gemini/status` | ✅ | Gemini connection status |
| 24 | POST | `/api/gemini/disconnect` | ✅ | Disconnect Gemini (alias) |
| 25 | GET | `/api/debug/session-registry` | ✅ | Debug session check |

---

## Global Error Responses

These can come back from **any** protected endpoint:

```json
// 401 — Not authenticated (no token or expired)
{ "detail": "Not authenticated" }
{ "detail": "Invalid or expired token" }
{ "detail": "User not found" }

// 422 — Validation error (wrong body fields)
{
  "detail": [
    {
      "loc": ["body", "fieldName"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}

// 500 — Internal server error
{ "detail": "Internal server error message" }
```

---

---

# 1. Health Check

## `GET /health`

**Auth:** Not required

**Use:** Ping the server to see if it's alive. Use this to check if the backend is up before showing the app.

**Request:** No body, no params.

**Response `200`:**
```json
{
  "status": "ok",
  "service": "webai-bridge"
}
```

---

---

# 2. Authentication

---

## `POST /auth/register`

**Auth:** Not required

**Use:** Create a new user account. Returns a JWT token on success so the user is logged in immediately after registering — no need for a separate login call.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "mypassword123"
}
```

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `email` | string | ✅ | Must contain `@`, stored lowercase |
| `password` | string | ✅ | Minimum 6 characters |

**Response `200` — Success:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "email": "user@example.com"
}
```

> ⚠️ **Store this token in `localStorage` or a state manager. Send it on every subsequent request as `Authorization: Bearer <token>`.**

**Error Responses:**
```json
// 409 — Email already taken
{ "detail": "Email already registered" }

// 422 — Invalid email
{ "detail": "Invalid email" }

// 422 — Password too short
{ "detail": "Password must be at least 6 characters" }
```

---

## `POST /auth/login`

**Auth:** Not required

**Use:** Log in with email and password. Returns a JWT token valid for **7 days**.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "mypassword123"
}
```

| Field | Type | Required |
|-------|------|----------|
| `email` | string | ✅ |
| `password` | string | ✅ |

**Response `200` — Success:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "email": "user@example.com"
}
```

**Error Responses:**
```json
// 401 — Wrong credentials (email not found OR wrong password)
{ "detail": "Invalid email or password" }
```

---

## `GET /auth/me`

**Auth:** ✅ Required

**Use:** Validate the stored token and get the current user's basic info. Call this when the app loads to check if the session is still valid.

**Request:** No body.

**Response `200`:**
```json
{
  "user_id": 5,
  "email": "user@example.com"
}
```

**Error Responses:**
```json
// 401 — Token invalid or expired
{ "detail": "Invalid or expired token" }
```

---

---

# 3. Gemini Connection (Cookies)

> Gemini uses browser cookies for authentication. Users must connect their Gemini account before they can chat. There are two ways: manual (paste the cookies) or automatic (extract from the browser on the same machine).

---

## `POST /api/cookies`

**Auth:** ✅ Required

**Use:** Manually save the user's Gemini cookies. The user gets these values from their browser's DevTools while logged into `gemini.google.com`. Use this when auto-extract is not available (e.g., browser not on the same machine).

**Request Body:**
```json
{
  "psid": "__Secure-1PSID cookie value here",
  "psidts": "__Secure-1PSIDTS cookie value here"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `psid` | string | ✅ | The `__Secure-1PSID` cookie from Google |
| `psidts` | string | ✅ | The `__Secure-1PSIDTS` cookie from Google |

**Response `200` — Success:**
```json
{
  "success": true,
  "message": "Gemini connected successfully"
}
```

**Error Responses:**
```json
// 422 — Cookie too short
{ "detail": "psid looks too short" }
{ "detail": "psidts looks too short" }

// 400 — Cookies saved but Gemini rejected them (invalid/expired)
{ "detail": "Gemini authentication failed: <reason>" }

// 500 — Database error
{ "detail": "Could not save cookies: <reason>" }
```

---

## `POST /api/cookies/extract`

**Auth:** ✅ Required

**Use:** Auto-extract Gemini cookies from the user's browser installed on the **same machine** as the backend server. Works only in local/self-hosted setups.

**Query Parameters:**

| Param | Type | Default | Options |
|-------|------|---------|---------|
| `browser` | string | `chrome` | `chrome`, `firefox`, `brave`, `edge`, `safari` |

**Example:** `POST /api/cookies/extract?browser=chrome`

**Request Body:** None

**Response `200` — Cookies found and saved:**
```json
{
  "success": true,
  "message": "Cookies found and applied automatically"
}
```

**Response `200` — User not logged into Gemini:**
```json
{
  "success": false,
  "message": "Not logged into gemini.google.com",
  "action_needed": "login"
}
```

**Response `200` — Extraction failed (permission, browser closed, etc.):**
```json
{
  "success": false,
  "message": "Extraction failed: <reason>",
  "action_needed": "manual"
}
```

> ⚠️ **Note:** This endpoint always returns HTTP `200`. Check the `success` field in the response body to determine if it worked. When `action_needed: "manual"`, show the user the manual cookie form instead.

**Error Responses:**
```json
// 400 — Invalid browser name
{ "detail": "Unknown browser 'xyz'. Use: chrome, firefox, brave, edge, safari" }
```

---

## `GET /api/cookies/status`

**Auth:** ✅ Required

**Use:** Check whether the current user has Gemini cookies saved (i.e., is connected). Use this to decide whether to show the "Connect Gemini" screen or the chat interface.

**Request:** No body.

**Response `200`:**
```json
// Connected
{
  "connected": true,
  "message": "Gemini connected"
}

// Not connected
{
  "connected": false,
  "message": "No Gemini session found"
}
```

---

## `DELETE /api/cookies`

**Auth:** ✅ Required

**Use:** Disconnect the user's Gemini account. Deletes their cookies from the database and removes their active Gemini session from memory.

**Request:** No body.

**Response `200`:**
```json
{
  "success": true,
  "message": "Gemini disconnected"
}
```

---

---

# 4. Chat (Simple / Stateless)

---

## `POST /api/chat`

**Auth:** ✅ Required

**Use:** Send a single message and get a **streaming** response. This is the **stateless** chat — it does NOT save messages to the database. Use it for quick chats. For persistent conversations with history, use the **Conversations** endpoints instead.

**Request Body:**
```json
{
  "message": "Explain quantum computing in simple terms",
  "model": "gemini-3-flash"
}
```

| Field | Type | Required | Default | Options |
|-------|------|----------|---------|---------|
| `message` | string | ✅ | — | Any text |
| `model` | string | ❌ | `gemini-3-flash` | `gemini-3-flash`, `gemini-3-pro` |

**Response:** `text/event-stream` (Server-Sent Events)

The response is a stream. Each chunk is a line formatted as:
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"index":0}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"},"index":0}]}

data: [DONE]
```

**How to read the stream (JavaScript example):**
```javascript
const response = await fetch('http://localhost:8000/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ message: 'Hello', model: 'gemini-3-flash' })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
      const json = JSON.parse(line.slice(6));
      const content = json.choices?.[0]?.delta?.content;
      if (content) {
        // Append content to your UI
      }
    }
  }
}
```

**Error chunk (still returned as a stream event):**
```
data: {"error": "error message here"}
```

---

---

# 5. Conversations

> Conversations persist chat history to the database. Each conversation has a title, a model, and holds many messages. Use these endpoints when you need history and continuity.

---

## `GET /api/conversations`

**Auth:** ✅ Required

**Use:** Get the list of all conversations for the logged-in user, ordered by most recently updated. Supports pagination.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | `20` | Number of conversations per page |
| `offset` | integer | `0` | Number to skip (for pagination) |

**Example:** `GET /api/conversations?limit=10&offset=0`

**Response `200`:**
```json
{
  "success": true,
  "total": 42,
  "conversations": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "user_id": 5,
      "title": "How does React work?",
      "model": "gemini-3-flash",
      "message_count": 8,
      "created_at": "2025-01-15T10:30:00",
      "updated_at": "2025-01-15T11:45:00"
    },
    {
      "id": "660e9500-f30c-52e5-b827-557766551111",
      "user_id": 5,
      "title": "Python async explained",
      "model": "gemini-3-pro",
      "message_count": 14,
      "created_at": "2025-01-14T09:00:00",
      "updated_at": "2025-01-14T09:30:00"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `total` | integer | Total number of conversations (before pagination) |
| `conversations` | array | The paginated list |
| `id` | string (UUID) | Conversation ID — use this in all subsequent calls |
| `title` | string | Conversation title |
| `model` | string | Gemini model used |
| `message_count` | integer | Total messages in this conversation |
| `created_at` | string (ISO 8601) | Creation timestamp |
| `updated_at` | string (ISO 8601) | Last activity timestamp |

---

## `POST /api/conversations`

**Auth:** ✅ Required

**Use:** Create a new empty conversation. Do this before sending the first message when you want persistent history.

**Request Body:**
```json
{
  "title": "My new chat",
  "model": "gemini-3-flash"
}
```

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `title` | string | ❌ | `"New Conversation"` |
| `model` | string | ❌ | `"gemini-3-flash"` |

**Response `200`:**
```json
{
  "success": true,
  "conversation": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": 5,
    "title": "My new chat",
    "model": "gemini-3-flash",
    "message_count": 0,
    "created_at": "2025-01-15T10:30:00",
    "updated_at": "2025-01-15T10:30:00"
  }
}
```

---

## `GET /api/conversations/{id}`

**Auth:** ✅ Required

**Use:** Get a single conversation's details **plus all its messages** in one call. Use this to restore a conversation when the user opens it.

**Path Parameter:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Conversation ID |

**Response `200`:**
```json
{
  "success": true,
  "conversation": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": 5,
    "title": "How does React work?",
    "model": "gemini-3-flash",
    "message_count": 2,
    "created_at": "2025-01-15T10:30:00",
    "updated_at": "2025-01-15T10:35:00"
  },
  "messages": [
    {
      "id": "msg-uuid-1",
      "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
      "role": "user",
      "content": "How does React work?",
      "created_at": "2025-01-15T10:30:05"
    },
    {
      "id": "msg-uuid-2",
      "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
      "role": "assistant",
      "content": "React is a JavaScript library for building user interfaces...",
      "created_at": "2025-01-15T10:30:08"
    }
  ]
}
```

**Error Responses:**
```json
// 404 — Conversation not found or doesn't belong to this user
{ "detail": "Conversation not found" }
```

---

## `PUT /api/conversations/{id}`

**Auth:** ✅ Required

**Use:** Update a conversation's title or model. Use this when the user renames a conversation or you want to auto-generate a title from the first message.

**Path Parameter:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Conversation ID |

**Request Body:**
```json
{
  "title": "React deep dive",
  "model": "gemini-3-pro"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | string | ❌ | Send only what you want to change |
| `model` | string | ❌ | Send only what you want to change |

**Response `200`:**
```json
{
  "success": true,
  "conversation": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": 5,
    "title": "React deep dive",
    "model": "gemini-3-pro",
    "message_count": 0,
    "created_at": "2025-01-15T10:30:00",
    "updated_at": "2025-01-15T11:00:00"
  }
}
```

**Error Responses:**
```json
// 404 — Not found or doesn't belong to user
{ "detail": "Conversation not found" }
```

---

## `DELETE /api/conversations/{id}`

**Auth:** ✅ Required

**Use:** Delete a single conversation and **all its messages** (cascade delete).

**Path Parameter:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Conversation ID |

**Request:** No body.

**Response `200`:**
```json
{
  "success": true,
  "message": "Conversation deleted"
}
```

**Error Responses:**
```json
// 404 — Not found or doesn't belong to user
{ "detail": "Conversation not found" }
```

---

## `DELETE /api/conversations`

**Auth:** ✅ Required

**Use:** Delete **all** conversations for the current user. Use for a "clear all history" button. This also deletes all messages inside them.

**Request:** No body.

**Response `200`:**
```json
{
  "success": true,
  "deleted_count": 12,
  "message": "Deleted 12 conversations"
}
```

---

---

# 6. Messages

---

## `POST /api/conversations/{id}/messages`

**Auth:** ✅ Required

**Use:** Send a message inside a conversation and get a **streaming** response. This is the **main chat endpoint** — it:
1. Saves the user message to the database
2. Streams the AI response back
3. Saves the completed AI response to the database

**Path Parameter:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Conversation ID |

**Request Body:**
```json
{
  "message": "What are React hooks?",
  "model": "gemini-3-flash"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `message` | string | ✅ | The user's message text |
| `model` | string | ❌ | Overrides the conversation's model for this message only. If not sent, uses the conversation's model. |

**Response:** `text/event-stream` (Server-Sent Events) — same format as `/api/chat`

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"React hooks"},"index":0}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":" are functions..."},"index":0}]}

data: [DONE]
```

**Error Responses:**
```json
// 404 — Conversation not found (before streaming starts)
{ "detail": "Conversation not found" }

// Error mid-stream (inside the stream itself)
data: {"error": "error message here"}
```

> 💡 **Frontend tip:** After the stream ends (`[DONE]`), the full assistant message is already saved in the database. No extra API call needed.

---

## `GET /api/conversations/{id}/messages`

**Auth:** ✅ Required

**Use:** Fetch messages for a conversation with pagination. Use this if you need to load older messages separately (e.g., infinite scroll upward).

> **Note:** `GET /api/conversations/{id}` already returns messages (default 50). Use this endpoint only if you need pagination beyond that.

**Path Parameter:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Conversation ID |

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | `50` | Messages per page |
| `offset` | integer | `0` | Number to skip |

**Response `200`:**
```json
{
  "success": true,
  "total": 24,
  "messages": [
    {
      "id": "msg-uuid-1",
      "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
      "role": "user",
      "content": "What are React hooks?",
      "created_at": "2025-01-15T10:30:05"
    },
    {
      "id": "msg-uuid-2",
      "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
      "role": "assistant",
      "content": "React hooks are functions that let you...",
      "created_at": "2025-01-15T10:30:09"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `role` | string | Either `"user"` or `"assistant"` |
| `content` | string | The full text of the message |
| `created_at` | string (ISO 8601) | Message timestamp (messages ordered oldest → newest) |

---

## `DELETE /api/conversations/{id}/messages/{message_id}`

**Auth:** ✅ Required

**Use:** Delete a single message from a conversation.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Conversation ID |
| `message_id` | string (UUID) | Message ID |

**Request:** No body.

**Response `200`:**
```json
{
  "success": true,
  "message": "Message deleted"
}
```

**Error Responses:**
```json
// 404 — Message not found or not owned by this user
{ "detail": "Message not found" }
```

---

---

# 7. Models

---

## `GET /api/models`

**Auth:** ✅ Required

**Use:** Get the list of available Gemini models. The `available` field reflects whether the user has Gemini connected. Show this list in any model selector dropdown.

**Request:** No body.

**Response `200`:**
```json
{
  "success": true,
  "models": [
    {
      "id": "gemini-3-flash",
      "name": "Gemini 3 Flash",
      "description": "Fast and efficient model for quick responses",
      "contextWindow": "1M tokens",
      "badge": "Fast",
      "available": true
    },
    {
      "id": "gemini-3-pro",
      "name": "Gemini 3 Pro",
      "description": "Advanced model for complex tasks",
      "contextWindow": "2M tokens",
      "badge": "Pro",
      "available": true
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Model ID — use this in all chat/conversation requests |
| `name` | string | Display name for UI |
| `description` | string | Short description |
| `contextWindow` | string | Context size (display only) |
| `badge` | string | Label for a badge chip in the UI (e.g., "Fast", "Pro") |
| `available` | boolean | `false` if user hasn't connected Gemini yet |

---

---

# 8. User Profile

---

## `GET /api/user/profile`

**Auth:** ✅ Required

**Use:** Get the full profile of the logged-in user including preferences (default model, theme). Call this on settings page load.

**Request:** No body.

**Response `200`:**
```json
{
  "success": true,
  "user": {
    "user_id": 5,
    "email": "user@example.com",
    "created_at": "2025-01-01T00:00:00",
    "last_login": null,
    "preferences": {
      "default_model": "gemini-3-flash",
      "theme": "dark"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `user_id` | integer | The user's numeric ID |
| `email` | string | User's email |
| `created_at` | string (ISO 8601) | Account creation date |
| `last_login` | string / null | Always `null` for now (not yet tracked) |
| `preferences.default_model` | string | User's preferred model |
| `preferences.theme` | string | `"dark"` or `"light"` |

---

## `PUT /api/user/profile`

**Auth:** ✅ Required

**Use:** Update the user's preferences. Send only the fields you want to change.

**Request Body:**
```json
{
  "default_model": "gemini-3-pro",
  "theme": "light"
}
```

| Field | Type | Required | Options |
|-------|------|----------|---------|
| `default_model` | string | ❌ | `"gemini-3-flash"`, `"gemini-3-pro"` |
| `theme` | string | ❌ | `"dark"`, `"light"` |

**Response `200`:**
```json
{
  "success": true,
  "message": "Preferences updated"
}
```

---

## `POST /api/user/logout`

**Auth:** ✅ Required

**Use:** Explicit logout. The server doesn't track sessions (JWT is stateless), so this mainly signals the frontend to clear the token. Always clear the token from `localStorage` after calling this.

**Request:** No body.

**Response `200`:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

---

# 9. Gemini Status

---

## `GET /api/gemini/status`

**Auth:** ✅ Required

**Use:** Get the Gemini connection status with the list of available models. More detailed than `/api/cookies/status`. Use this on the settings or connection page.

**Request:** No body.

**Response `200` — Connected:**
```json
{
  "success": true,
  "connected": true,
  "user_id": 5,
  "message": "Gemini connected",
  "available_models": ["gemini-3-flash", "gemini-3-pro"]
}
```

**Response `200` — Not connected:**
```json
{
  "success": true,
  "connected": false,
  "user_id": 5,
  "message": "No Gemini session found",
  "available_models": []
}
```

---

## `POST /api/gemini/disconnect`

**Auth:** ✅ Required

**Use:** Disconnect the user's Gemini account. This is a semantic alias for `DELETE /api/cookies` — both do the same thing. Use whichever fits your UI flow better.

**Request:** No body.

**Response `200`:**
```json
{
  "success": true,
  "message": "Gemini disconnected"
}
```

---

---

# 10. Debug

---

## `GET /api/debug/session-registry`

**Auth:** ✅ Required

**Use:** Check if the user's Gemini session exists in the WebAI engine's memory. Use this for debugging connection issues — for example, when a user has cookies saved but chat is failing. **Not for production UI.**

**Request:** No body.

**Response `200` — Session exists:**
```json
{
  "user_id": "5",
  "status": 200,
  "body": "...",
  "session_exists": true
}
```

**Response `200` — Session missing:**
```json
{
  "user_id": "5",
  "status": 404,
  "body": "...",
  "session_exists": false
}
```

**Response `200` — Error reaching WebAI engine:**
```json
{
  "user_id": "5",
  "error": "Connection refused",
  "session_exists": false
}
```

---

---

# Appendix A — Common Frontend Flows

## Flow 1: App Startup
```
1. Read token from localStorage
2. If no token → redirect to /login
3. GET /auth/me
   - 401 → clear token, redirect to /login
   - 200 → user is logged in, proceed
4. GET /api/cookies/status
   - connected: false → redirect to /connect-gemini
   - connected: true → show main chat UI
```

## Flow 2: Register / Login
```
1. POST /auth/register  OR  POST /auth/login
2. On success → store token in localStorage
3. GET /api/cookies/status to check Gemini connection
4. Redirect accordingly
```

## Flow 3: Connecting Gemini
```
Option A — Manual:
  1. User pastes PSID and PSIDTS into a form
  2. POST /api/cookies
  3. success: true → show chat
  4. success: false → show error

Option B — Auto-extract:
  1. POST /api/cookies/extract?browser=chrome
  2. success: true → show chat
  3. action_needed: "login" → tell user to log into Gemini first
  4. action_needed: "manual" → show manual form
```

## Flow 4: Starting a New Conversation
```
1. POST /api/conversations  (with title + model)
2. Store returned conversation.id
3. User types message → POST /api/conversations/{id}/messages
4. Stream response to UI
5. Stream ends → messages are already saved, nothing extra needed
```

## Flow 5: Reopening a Past Conversation
```
1. GET /api/conversations  → show list in sidebar
2. User clicks one → GET /api/conversations/{id}
3. Response has conversation info + all messages
4. Render messages in the chat window
5. User sends new message → POST /api/conversations/{id}/messages
```

## Flow 6: Logout
```
1. POST /api/user/logout  (optional, good practice)
2. Clear token from localStorage
3. Redirect to /login
```

---

# Appendix B — Data Types Reference

| Type | Format | Example |
|------|--------|---------|
| User ID | integer | `5` |
| Conversation ID | UUID string | `"550e8400-e29b-41d4-a716-446655440000"` |
| Message ID | UUID string | `"660f9500-a11b-42e5-c938-668877662222"` |
| Timestamp | ISO 8601 string | `"2025-01-15T10:30:00"` |
| Model ID | string | `"gemini-3-flash"` or `"gemini-3-pro"` |
| Role | string | `"user"` or `"assistant"` |
| Theme | string | `"dark"` or `"light"` |

---

# Appendix C — HTTP Status Codes Used

| Code | Meaning | When |
|------|---------|------|
| `200` | OK | Request succeeded |
| `400` | Bad Request | Gemini auth failed, invalid browser |
| `401` | Unauthorized | No token, expired token, user deleted |
| `404` | Not Found | Conversation/message doesn't exist or doesn't belong to user |
| `409` | Conflict | Email already registered |
| `422` | Unprocessable | Validation error (missing field, wrong type) |
| `500` | Server Error | Unexpected internal error |

---

*API Base URL: `http://localhost:8000` — update `VITE_API_URL` in the frontend `.env` for production.*
