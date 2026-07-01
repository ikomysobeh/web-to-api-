# Gemini Expired — Why You Can't Reconnect (simple) + Fix

**Date:** 2026-07-01
**Status:** Design only — confirm, then I build.

## What works now ✅
When Gemini is expired, the chat shows the message:
> "Your Gemini connection has expired. Please reconnect Gemini to keep chatting."

Good — no more empty bubble.

## What's still wrong ❌
You keep sending messages and get the **same error every time**, with **no real way to
reconnect**. The reconnect popup either doesn't stay open, or reconnecting doesn't fix it.
You're stuck in a loop (your screenshot: "hi" → error, "hi" → error, "hi" → error).

---

## The real reason (this is the key part)

The system decides "is Gemini connected?" by checking **"do we have saved cookies in the
database?"** — **not** "are those cookies still valid at Google?"

When your Gemini session expires:
- The cookies are **still saved** in our database (they just don't work at Google anymore).
- So the system still thinks: **"connected ✅"** — even though it's really broken.

This one wrong assumption causes the whole loop:

```
Cookies saved in DB, but EXPIRED at Google
        │
        ├─ Chat pre-check "has cookies?"  → YES → lets you send → Google rejects → error
        │
        └─ Reconnect popup opens → checks "connected?" → sees cookies exist → thinks
           "already connected!" → closes itself → you never get to reconnect
```

So: the error message is correct, but **nothing lets you actually fix it**, because the
app believes you're still connected.

---

## The fix (break the loop)

**Main idea:** when a chat fails because Gemini rejected the cookies, **mark those cookies
as invalid** (delete them). After that, the app correctly knows you're "not connected", so:
- the reconnect popup **stays open** and waits for the extension,
- the pre-check correctly says "connect Gemini first",
- once the extension saves **fresh** cookies, chatting works again.

### Part A — Backend: drop the dead cookies on auth failure
In the chat streaming code, when the response from Gemini is an **auth/expiry error**,
delete that user's stored cookies (`delete_cookies(user_id)` — already exists).
- Only on clear auth/expiry errors (not on a random network blip).
- Result: `/api/cookies/status` now correctly returns **not connected**.

### Part B — Frontend: make the reconnect popup actually help
Right now the popup auto-closes the moment it sees "connected" (cookies exist). After
Part A the status will be "not connected", so the popup naturally stays open and works.
- Also add a clear **"Reconnect Gemini"** action so the user isn't confused — clicking it
  opens the same Connect-Gemini popup on demand (not only automatically).

### Part C (optional, nicer) — Know expiry sooner
Today we only find out cookies are dead **when you send a message**. Optionally, the
"connected" check could actually **test** the cookies (ask Gemini a tiny request) instead
of just checking they exist — so the app knows earlier. This is more work; we can skip it
for now since Part A already fixes the loop.

---

## Files to change
| File | Change | Part |
|---|---|---|
| `webai-bridge/main.py` | On a Gemini auth/expiry error in the chat stream, call `delete_cookies(user_id)`. Apply in `/api/chat`, `/api/conversations/{id}/messages`, and the embed chat. | A |
| `web2api-ui/src/components/modals/CookieSetupModal.tsx` | (Behavior already becomes correct after Part A.) Optionally add clearer "expired — reconnect" wording. | B |
| `web2api-ui/src/stores/conversationStore.ts` | Already opens the popup on the error — keep. Optionally expose a `reconnectGemini()` action for a manual button. | B |
| `webai-bridge/services/cookie_service.py` | (Optional Part C) add a `validate_cookies()` that pings Gemini. | C |

> `delete_cookies` is already imported and available in `main.py` — Part A is small.

---

## What you'll see after the fix
1. Gemini expires → you send a message → clear error message (as now).
2. The dead cookies are cleared, so the app now knows you're **not connected**.
3. The **Connect Gemini popup opens and stays open**, waiting for the extension.
4. You click the extension's "Connect Gemini Automatically" → fresh cookies saved.
5. Chatting works again. No more loop.

---

## Confirm before I build
1. Do **Part A + B** (recommended — fixes the loop, small change)? Or also **Part C**
   (test cookies proactively so we detect expiry before you even send a message)?
2. On an auth error, is it OK to **delete** the stored cookies automatically? (Recommended
   — they're dead anyway, and it's what unblocks the reconnect.)
