# Login Redirect + Error Messages — Plan (simple)

**Date:** 2026-07-01
**Status:** Design only — no code changed yet. Confirm, then I build.

Two problems to fix.

---

## Problem 1 — Login page shows even when already signed in

### What happens now
If you're signed in and you open `/login`, it still shows the login form. It should send
you straight to the chat.

### Why
`LoginPage` never checks if you already have a token. It just always shows the form.

### The fix (simple)
At the top of `LoginPage`, check: *"do I already have a token?"*
- **Yes** → immediately redirect to `/chat` (no form).
- **No** → show the login form as normal.

```
open /login
   │
   ├── already signed in?  ── yes ──►  go to /chat
   └── no ──►  show login form
```

### File
| File | Change |
|---|---|
| `web2api-ui/src/pages/LoginPage.tsx` | Use `useAuth()`; if `token` exists, `<Navigate to="/chat" replace />`. |

> Bonus: while auth is still loading we show a spinner, so it never "flashes" the form.

---

## Problem 2 — Silent failure when Gemini is expired (and unfriendly errors elsewhere)

### What happens now
You send a message, but your Gemini connection is expired/invalid. **Nothing appears** —
an empty reply bubble, no explanation. You don't know what went wrong or what to do.

### Why (the real cause)
The backend **does** send an error. When Gemini fails, it streams a line like:
```
data: {"error": "…gemini session expired…"}
```
But the **frontend ignores it.** The code that reads the stream only looks for normal text
(`choices[].delta.content`) and skips anything with `error`. So the error is thrown away
and you see an empty bubble.

```
Gemini expired
   │
backend sends:  data: {"error": "..."}   ✅ (it's there)
   │
frontend reads stream → only looks for text, ignores "error"  ❌
   │
result: empty bubble, no message
```

### The fix — 3 parts

**Part A — Frontend: actually read the error (the main fix)**
In the streaming reader (`conversationStore.ts`), when a line contains `error`, stop and
show it as a clear message instead of ignoring it.
- If the error looks like a Gemini/auth problem → show:
  *"Your Gemini connection has expired. Please reconnect Gemini to keep chatting."*
  and **open the Connect-Gemini popup** automatically.
- Any other error → show the message text in the reply bubble (not empty).

**Part B — Backend: make the Gemini error clear**
Right now the backend forwards Google's raw error text (technical). We add:
- A quick **check before sending**: if the user has no Gemini cookies, return a clear
  *"Connect your Gemini account first"* (same check the embed chat already uses).
- If Google rejects mid-stream, wrap it as a clean message like
  *"Gemini session expired — please reconnect."* instead of raw text.

**Part C — Friendly errors on the other pages**
Make one small helper, `getErrorMessage(err)`, that turns any failure (a `Response`, a
network error, etc.) into a readable sentence. Use it in the places that currently show
raw errors or nothing: login, admin create/edit (agents, embeds, users), document upload,
suggestions. So every page shows a human message like *"Something went wrong. Please try
again."* or the specific reason.

### Files
| File | Change | Part |
|---|---|---|
| `web2api-ui/src/stores/conversationStore.ts` | Detect `error` in the stream → show friendly message; flag Gemini-expired. | A |
| `web2api-ui/src/app/AppShell.tsx` (or the store) | When a Gemini-expired error happens, open the Connect-Gemini modal. | A |
| `webai-bridge/main.py` | Pre-check `has_cookies` on chat; clean up the streamed error text for auth/expiry. | B |
| `web2api-ui/src/lib/errors.ts` (new) | `getErrorMessage(err)` helper. | C |
| Various pages (`LoginPage`, admin pages, `WidgetPage`) | Use `getErrorMessage` in catch blocks. | C |

---

## What you'll see after the fix

**Login:** signed in + open `/login` → you land on `/chat` instantly. No form.

**Gemini expired:** you send a message → a clear bubble appears:
> ⚠ Your Gemini connection has expired. Please reconnect Gemini to keep chatting.

…and the Connect-Gemini popup opens so you can fix it in one click.

**Other errors anywhere:** a readable sentence instead of a blank screen or raw code.

---

## Build order
1. **Problem 1** (login redirect) — tiny, 1 file.
2. **Problem 2 Part A** (frontend reads the error) — the fix that stops the silent failure.
3. **Problem 2 Part B** (backend clearer error + pre-check).
4. **Problem 2 Part C** (shared helper + apply on other pages).
5. Build + verify.

---

## Confirm before I build
1. When Gemini is expired, should I **auto-open the Connect-Gemini popup** (recommended),
   or just show the message and let the user click a "Reconnect" button?
2. Part C touches several pages to standardize error text — OK to do that sweep, or keep it
   to just the chat + login for now?
