# Frontend Changes Plan

Three independent changes. Each section explains what the current code does,
what needs to change, and exactly which files to touch.

---

## Change 1 — Add More Models to `/api/models`

### What it is right now

The backend endpoint `GET /api/models` in `webai-bridge/main.py` (lines 887–904)
returns a hardcoded list of exactly 2 models:

```python
models = [
    { "id": "gemini-3-flash", "name": "Gemini 3 Flash", ... },
    { "id": "gemini-3-pro",   "name": "Gemini 3 Pro",   ... },
]
```

The frontend has 3 model names defined in `web2api-ui/src/data/mockChats.ts`
(lines 21–43):

```ts
export const AI_MODELS: AIModel[] = [
  { id: "lumina-flash",     name: "Lumina Flash",     badge: "Fast" },
  { id: "lumina-pro",       name: "Lumina Pro",       badge: "Pro" },
  { id: "lumina-reasoning", name: "Lumina Reasoning", badge: "Reasoning" },
]
```

And in `web2api-ui/src/app/AppShell.tsx` (lines 71–75) there is a mapping
from frontend model IDs to backend model IDs — currently every frontend model
maps to the same backend string `"gemini-3-flash"`:

```ts
const MODEL_MAP: Record<AIModelId, string> = {
  "lumina-flash":     "gemini-3-flash",
  "lumina-pro":       "gemini-3-flash",
  "lumina-reasoning": "gemini-3-flash",
}
```

### What to change

**File 1 — `webai-bridge/main.py`** (the `/api/models` endpoint, ~line 887)

Add the models that are actually supported. The real Gemini model names used
by WebAI-to-API are what matter here. Add at minimum a third entry. Example:

```python
models = [
    {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash",
        "description": "Fast and efficient — best for quick responses",
        "contextWindow": "1M tokens",
        "badge": "Fast",
        "available": connected
    },
    {
        "id": "gemini-2.5-pro",
        "name": "Gemini 2.5 Pro",
        "description": "Advanced reasoning for complex tasks",
        "contextWindow": "1M tokens",
        "badge": "Pro",
        "available": connected
    },
    {
        "id": "gemini-2.0-flash",
        "name": "Gemini 2.0 Flash",
        "description": "Previous generation — stable and fast",
        "contextWindow": "1M tokens",
        "badge": "Stable",
        "available": connected
    },
]
```

> Use whatever model IDs WebAI-to-API actually accepts. Check with
> `GET http://localhost:6969/models` or the WebAI-to-API docs.

**File 2 — `web2api-ui/src/types/chat.ts`** (line 26)

The `AIModelId` union type controls what model IDs the frontend knows about.
Add or rename to match the new models:

```ts
// Before
export type AIModelId = "lumina-flash" | "lumina-pro" | "lumina-reasoning"

// After (example — adjust names to match what you want to show users)
export type AIModelId = "lumina-flash" | "lumina-pro" | "lumina-reasoning"
// OR rename them entirely — up to you
```

**File 3 — `web2api-ui/src/data/mockChats.ts`** (lines 21–43)

Update `AI_MODELS` to add/rename models. The `id` here is the frontend ID
(what the dropdown shows). The badge, description and contextWindow are
display-only — just marketing text.

**File 4 — `web2api-ui/src/app/AppShell.tsx`** (lines 71–75)

The `MODEL_MAP` translates a frontend ID → the backend model string that gets
sent to `/api/chat`. THIS is the important mapping. Each frontend model name
needs to point to a real backend model ID:

```ts
const MODEL_MAP: Record<AIModelId, string> = {
  "lumina-flash":     "gemini-2.5-flash",   // fast
  "lumina-pro":       "gemini-2.5-pro",     // pro
  "lumina-reasoning": "gemini-2.0-flash",   // or whatever the 3rd real model is
}
```

### Summary of files

| File | What to change |
|---|---|
| `webai-bridge/main.py` ~line 887 | Add more model objects to the hardcoded list |
| `web2api-ui/src/app/AppShell.tsx` line 71 | Fix `MODEL_MAP` so each ID maps to a real backend model |
| `web2api-ui/src/data/mockChats.ts` line 21 | Update `AI_MODELS` display names/descriptions |
| `web2api-ui/src/types/chat.ts` line 26 | Only if you rename the model IDs |

---

## Change 2 — Logout Should NOT Disconnect Gemini

### What it is right now

The logout button is in `web2api-ui/src/components/layout/SidebarFooter.tsx`
(lines 26–29):

```ts
function handleLogout() {
  logout()        // ← clears localStorage token
  navigate("/login")
}
```

The `logout()` function in `web2api-ui/src/context/AuthContext.tsx` (lines 61–67)
only clears the token from `localStorage`:

```ts
function logout() {
  localStorage.removeItem('auth_token')
  localStorage.removeItem('auth_email')
  localStorage.removeItem('auth_role')
  setToken(null)
  setUser(null)
}
```

So currently **logout does NOT disconnect Gemini**. The Gemini cookies stay saved
in the database. The next time the same user logs in, they are still connected.

However, there is a backend endpoint `POST /api/gemini/disconnect` (or
`DELETE /api/cookies`) that removes the cookies from the database. It is never
called during logout right now.

The question is: **should logout disconnect Gemini or not?**

- **Keep them separate (current behaviour, recommended):** Logout = end the session.
  Gemini cookies stay. User logs back in and is still connected. Good UX.
- **Disconnect on logout:** Every logout forces the user to re-enter Gemini cookies
  next time. Annoying, but more secure if this is a shared device.

### What to change

**If you want to keep them separate** — no code change needed. But add a dedicated
"Disconnect Gemini" button somewhere (Settings page, or inside the cookie modal).

**If you want logout to also disconnect Gemini** — change
`web2api-ui/src/components/layout/SidebarFooter.tsx`:

```ts
// File: web2api-ui/src/services/api.ts
// Add this function (it doesn't exist yet):
export async function disconnectGemini(token: string): Promise<void> {
  await fetch(`${BASE}/api/gemini/disconnect`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  // intentionally ignore errors — if it fails, we still log out
}
```

```ts
// File: web2api-ui/src/components/layout/SidebarFooter.tsx
// Change handleLogout to:
async function handleLogout() {
  if (token) {
    await disconnectGemini(token).catch(() => {})  // best-effort
  }
  logout()
  navigate("/login")
}
```

You would also need to import `token` from `useAuth()` and make the function
`async`.

### Summary of files

| File | What to change |
|---|---|
| `web2api-ui/src/services/api.ts` | Add `disconnectGemini()` function |
| `web2api-ui/src/components/layout/SidebarFooter.tsx` | Call it in `handleLogout` (only if you want them linked) |

---

## Change 3 — Copy and Edit Buttons on Messages

### What it is right now

Messages are rendered in `web2api-ui/src/components/chat/ChatMessages.tsx`.
The `MessageBubble` component (line 91–153) shows:
- The avatar
- The message bubble (text content)
- A timestamp below

There are **no action buttons** at all. No copy, no edit, nothing.

The `ChatMessage` type in `web2api-ui/src/types/chat.ts` has these fields:
```ts
interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  createdAt: Date
  status: "sending" | "streaming" | "done" | "error"
}
```

### What to change

**Approach: show buttons on hover**

Add a row of icon buttons that appears when the user hovers over a message bubble.
Use `useState` or CSS group-hover to control visibility.

**For assistant messages — Copy button:**
- Click → `navigator.clipboard.writeText(message.content)`
- Icon: `Copy` from lucide-react (already installed)
- Button shows "Copied!" for 2 seconds then resets (use `useState<boolean>`)

**For user messages — Copy + Edit buttons:**
- Copy works the same
- Edit: re-fills the chat input with that message text so the user can modify
  and re-send it
- To do edit: you need to pass a callback `onEditMessage(content: string)` down
  from `ChatMessages` → `MessageBubble`
- That callback calls `onSendMessage` equivalent, but just pre-fills the input
  (or replaces and sends immediately — your choice)

**File: `web2api-ui/src/components/chat/ChatMessages.tsx`**

Changes needed:
1. Add `useState` import (already imported in React, just add it)
2. Add `onEditMessage?: (content: string) => void` prop to `MessageBubble`
3. Inside `MessageBubble`: add a `const [copied, setCopied] = useState(false)` 
4. Add the hover button group below the bubble, above the timestamp:

```tsx
// Sketch of what to add inside MessageBubble, after the bubble div:
<div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
  <button onClick={handleCopy} title="Copy">
    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
  </button>
  {isUser && (
    <button onClick={() => onEditMessage?.(message.content)} title="Edit">
      <Pencil className="size-3.5" />
    </button>
  )}
</div>
```

5. Wrap the outer `div` of `MessageBubble` with `group` Tailwind class so
   `group-hover:` works
6. Import `Copy`, `Check`, `Pencil` from `lucide-react`

**File: `web2api-ui/src/components/chat/ChatInput.tsx`**

The edit flow needs to be able to pre-fill the input. Add a prop or ref to let
the parent push text into the input:

```ts
// Add to ChatInput props:
initialValue?: string
```

Or expose a ref with an `setValue` method. The simplest approach is to lift
the input state up to `ChatMessages` and pass it as a controlled value.

**File: `web2api-ui/src/components/chat/ChatMessages.tsx`**

Add `onEditMessage` callback to the `ChatMessagesProps` interface (defined in
`AppShell.tsx`) and wire it: clicking Edit on a user message pre-fills the
`ChatInput` with that message text.

### Summary of files

| File | What to change |
|---|---|
| `web2api-ui/src/components/chat/ChatMessages.tsx` | Add hover buttons (Copy, Edit) to `MessageBubble` |
| `web2api-ui/src/components/chat/ChatInput.tsx` | Accept optional `value` / `initialValue` prop for pre-fill |
| `web2api-ui/src/app/AppShell.tsx` | Pass `onEditMessage` handler that sets the input value |

---

## All Files at a Glance

| # | Change | Files |
|---|---|---|
| 1 | More models | `webai-bridge/main.py`, `AppShell.tsx`, `mockChats.ts`, `chat.ts` (types) |
| 2 | Logout / disconnect | `api.ts` (add fn), `SidebarFooter.tsx` (call it) |
| 3 | Copy + Edit on messages | `ChatMessages.tsx`, `ChatInput.tsx`, `AppShell.tsx` |

Each change is independent — you can do them in any order.

---

## One Question Before We Start Change 2

**Do you want logout to also disconnect Gemini, or keep them separate?**

- **Separate (recommended):** Logout just ends the session. Gemini stays connected.
  User logs back in and can chat immediately without re-entering cookies. Add a
  separate "Disconnect Gemini" button somewhere.
- **Together:** Every logout clears Gemini cookies. User must re-enter cookies on
  next login. More work for the user, slightly more secure on shared machines.
