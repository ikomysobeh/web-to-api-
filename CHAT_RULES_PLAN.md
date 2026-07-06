# Chat Page — Two Rules (Plan)

**Date:** 2026-07-01
**Status:** Design only — no code written yet

Two changes requested on the chat page:
1. **Lock the agent** — once a user picks an agent and starts chatting in a conversation,
   they can't change or clear the agent for that conversation.
2. **Only the last message is editable** — the Edit button appears only on the last
   message, never on earlier ones (3 messages → only #3; 4 messages → only #4).

---

## Feature 1 — Lock the agent after chat starts

### How it works today
- The agent is chosen in the **AgentDropdown** (shown in `ChatHome` for a new chat, and in
  `ChatInput` during an active conversation).
- The choice lives in **one global** store value: `selectedAgentId`
  (`conversationStore.ts`). Every send passes it along
  (`sendMessage → sendConversationMessage(..., selectedAgentId)`).
- The agent is **not tied to the conversation** — the dropdown stays fully changeable, and
  its `X` can clear the agent mid-chat. Switching to another conversation does **not**
  change `selectedAgentId`, so the chip can even show the wrong agent.

### Good news: the backend already supports per-conversation agents
- `conversations` table has an `agent_id` column.
- `ConversationCreate` schema has `agent_id` (`schemas/conversations.py:8`).
- `POST /api/conversations` already stores it (`main.py:659-664`).
- `ConversationResponse` returns `agent_id` (`schemas/conversations.py:19`).

So the only gap is on the **frontend**: it never sends `agent_id` at creation and never
reads it back. We'll close that gap — this is both the correct fix and a low-risk one.

### Recommended approach — persist on the conversation + lock the UI
Tie the agent to the conversation at creation, then lock it.

1. **Persist at creation.** When the first message creates the conversation, send the
   currently selected agent so it's saved on the conversation row.
2. **Derive the active agent from the conversation**, not the global value. When a
   conversation is open, the agent shown/used is `conversation.agent_id`.
3. **Lock the picker.** While a conversation is active (has an agent / has messages), the
   AgentDropdown renders as a **static chip** — no dropdown, no `X` to clear.
4. The picker is only **interactive** in the new-chat / empty state (`ChatHome`).

```
NEW CHAT (ChatHome)                ACTIVE CONVERSATION (ChatMessages)
─────────────────────              ─────────────────────────────────
[ Agent ▾ ]  ← changeable          [ 🤖 HR Assistant ]  ← locked chip, no ▾, no ✕
pick agent → send  ──────────────► agent saved on the conversation, fixed from now on
```

### Files to change (Feature 1)
| File | Change |
|---|---|
| `web2api-ui/src/services/api.ts` | `createConversation(token, title, model, agentId?)` — send `agent_id` in the body (backend already accepts it). |
| `web2api-ui/src/stores/conversationStore.ts` | `createAndSelectConversation` passes `selectedAgentId` to `createConversation`. Add a selector/derivation for the **active conversation's** `agent_id`. Have `sendMessage` use the conversation's agent (fallback to `selectedAgentId` for a brand-new chat). |
| `web2api-ui/src/app/AppShell.tsx` | For `ChatMessages`, pass the **conversation's** `agent_id` as `selectedAgentId` and pass a new `agentLocked` (true when the conversation has an agent or ≥1 message). Keep `ChatHome` using the global `selectedAgentId` (unlocked). |
| `web2api-ui/src/components/chat/ChatInput.tsx` | Accept `agentLocked?: boolean`; pass it to `AgentDropdown`. |
| `web2api-ui/src/components/chat/AgentDropdown.tsx` | Accept `locked?: boolean`. When locked: render a **static chip** (agent name only) — no toggle, no clear `X`, no menu. |
| `web2api-ui/src/types/chat.ts` | `ApiConversation` — confirm it carries `agent_id` (add if missing) so the frontend can read it. |

> **Backend:** no change needed — it already stores and returns `agent_id`.

### Simpler fallback (if you want the smallest change)
Skip persistence and just **disable** the AgentDropdown whenever the active conversation
has ≥1 message (`session.messages.length > 0`). One `locked` prop, no store/api changes.
- ✅ Satisfies "can't change after starting."
- ❌ Doesn't fix the wrong-agent-on-conversation-switch case (global value). Fine if users
  rarely switch between agent-bound conversations.

**Recommendation:** do the persisted approach — it's only a few extra lines and the backend
is already there, so it's correct rather than a patch.

### Edge cases
- **New chat:** picker fully editable until the first send.
- **Clear agent:** the `X` is hidden while locked (can't clear mid-chat).
- **Model dropdown:** already disabled when an agent is selected
  (`ChatInput.tsx:269`) — no change.
- **Opening an old conversation:** shows that conversation's own agent (with the persisted
  approach), locked.

---

## Feature 2 — Only the last message is editable

### How it works today
In `ChatMessages.tsx`, every **user** message renders an Edit (pencil) button
(`MessageBubble`, guarded by `isUser && !editing`, lines ~241-253). So all past user
messages are editable.

### Approach
Show Edit **only on the last message in the conversation**, keeping the existing
"user messages only" guard. So the pencil appears only when the last message is a user
message; all earlier messages lose it.

- In `ChatMessages`, compute `isLast = index === session.messages.length - 1` in the
  `.map(...)` and pass it to `MessageBubble`.
- In `MessageBubble`, change the edit-button condition from `isUser` to
  `isUser && isLast`.

```
msg #1 (user)      → no edit
msg #2 (assistant) → no edit
msg #3 (user)      → EDIT ✏   ← only the last one
```

### Files to change (Feature 2)
| File | Change |
|---|---|
| `web2api-ui/src/components/chat/ChatMessages.tsx` | Pass `isLast` into `MessageBubble` from the map; gate the Edit button on `isUser && isLast`. (Copy/Delete unchanged.) |

That's the whole change — one file, a few lines. Low risk.

### One thing to confirm (interpretation)
"Only the last message editable" is **position-based**: if the last message is an
**assistant** reply, then no message shows Edit (assistant messages were never editable).
- **Option A (recommended, matches your words):** Edit only on the last message, and only
  if it's a user message. Simple, literal.
- **Option B:** Edit on the **last _user_ message** even when an assistant reply came after
  it (so the user can always tweak their most recent prompt).

Both are one-file changes. I'll go with **Option A** unless you prefer B.

---

## Summary of files touched

| Area | File | Feature |
|---|---|---|
| Frontend | `services/api.ts` | 1 |
| Frontend | `stores/conversationStore.ts` | 1 |
| Frontend | `app/AppShell.tsx` | 1 |
| Frontend | `components/chat/ChatInput.tsx` | 1 |
| Frontend | `components/chat/AgentDropdown.tsx` | 1 |
| Frontend | `types/chat.ts` | 1 |
| Frontend | `components/chat/ChatMessages.tsx` | 2 |
| Backend | — | none (already supports `agent_id`) |

## Build order
1. **Feature 2 first** — it's a tiny, isolated change in one file; ship and verify quickly.
2. **Feature 1** — persist `agent_id` (api + store), derive per-conversation agent, then add
   the `locked` chip in `AgentDropdown` + wire `AppShell`/`ChatInput`.
3. `tsc` + build to verify.

## Questions before building
1. Feature 2 — **Option A or B** above? (default: A)
2. Feature 1 — **persisted** (recommended) or **simple UI-lock** approach?
