# Backend Changes — Review Before Applying

4 changes. Read each one, agree or adjust, then we apply them.

---

## Change 1 — Add More Models to `GET /api/models`

### Current code (`main.py` lines 887–904)

```python
models = [
    { "id": "gemini-3-flash", "name": "Gemini 3 Flash", ... },
    { "id": "gemini-3-pro",   "name": "Gemini 3 Pro",   ... },
]
```

Only 2 models, both hardcoded. The `id` values here are what gets sent to
WebAI-to-API when a user picks that model.

### What needs to change

Add more model entries. The `id` must match what WebAI-to-API actually
accepts — these are real Gemini model names. Based on the current Gemini
API the correct IDs are:

```python
models = [
    {
        "id":            "gemini-2.5-flash",
        "name":          "Gemini 2.5 Flash",
        "description":   "Fast and efficient — best for quick questions",
        "contextWindow": "1M tokens",
        "badge":         "Fast",
        "available":     connected
    },
    {
        "id":            "gemini-2.5-pro",
        "name":          "Gemini 2.5 Pro",
        "description":   "Best quality — complex tasks and reasoning",
        "contextWindow": "1M tokens",
        "badge":         "Pro",
        "available":     connected
    },
    {
        "id":            "gemini-2.0-flash",
        "name":          "Gemini 2.0 Flash",
        "description":   "Previous generation — stable and reliable",
        "contextWindow": "1M tokens",
        "badge":         "Stable",
        "available":     connected
    },
]
```

### File to change

`webai-bridge/main.py` — only the models list inside `list_models()`, ~line 887.
Nothing else changes in the backend.

### ⚠️ Question for you

Do you know the exact model ID strings that WebAI-to-API accepts?
Check `GET http://localhost:6969/models` or look in the WebAI-to-API config.
If the IDs above are wrong the chat will fail silently (WebAI-to-API will
reject the model name). Confirm the IDs before we apply this.

---

## Change 2 — Logout Should Also Disconnect Gemini

### Current code (`main.py` lines 1032–1040)

```python
@app.post("/api/user/logout")
def logout(user = Depends(get_current_user)):
    # does absolutely nothing on the server
    return {"success": True, "message": "Logged out successfully"}
```

The logout endpoint is empty. It returns success but leaves the user's
Gemini cookies sitting in the database. Their Gemini session stays alive.

There is already a working `DELETE /api/cookies` endpoint that properly
removes the cookies AND drops the WebAI client session:

```python
# DELETE /api/cookies  (line 623)
async def disconnect_gemini(user):
    delete_cookies(user["user_id"])
    await remove_webai_client_for_user(user["user_id"])
    return {"success": True, "message": "Gemini disconnected"}
```

### What needs to change

Make `logout` call the same cleanup. The function also needs to become
`async` because `remove_webai_client_for_user` is an async function:

```python
@app.post("/api/user/logout")
async def logout(user = Depends(get_current_user)):
    delete_cookies(user["user_id"])
    await remove_webai_client_for_user(user["user_id"])
    return {"success": True, "message": "Logged out successfully"}
```

### File to change

`webai-bridge/main.py` — only the `logout()` function body, ~line 1034.

### ⚠️ Question for you

There are two possible behaviours — confirm which one you want:

- **Option A (recommended):** Logout ALWAYS disconnects Gemini.
  Next login the user must re-enter cookies. Simple and clean.

- **Option B:** Logout does NOT disconnect Gemini.
  Cookies stay saved. User logs back in and chat works immediately.
  Only a dedicated "Disconnect Gemini" button removes cookies.

The change above implements Option A. Tell me if you want Option B instead
(in that case, no backend change is needed for this item — just
a frontend-only change to the logout button).

---

## Change 3 — Copy and Edit Messages

### What the frontend needs from the backend

**Copy** is 100% frontend — clicking a button calls
`navigator.clipboard.writeText(message.content)`. No backend involved.

**Edit** depends on what "edit" means:

**Option A — Edit = re-send (most common in chat apps)**
The user clicks Edit on their message, the text is put back in the input
box, they modify it and send it as a new message.
→ No backend change needed. The frontend handles it locally.

**Option B — Edit = update a saved message in the database**
The user edits an old message and the stored history is changed.
→ Needs a new backend endpoint: `PUT /api/conversations/{id}/messages/{msg_id}`

### Current message endpoints

```
POST   /api/conversations/{id}/messages   → send new message (streaming)
GET    /api/conversations/{id}/messages   → list messages
DELETE /api/conversations/{id}/messages/{msg_id}  → delete a message
PUT    /api/conversations/{id}/messages/{msg_id}  → DOES NOT EXIST YET
```

### What needs to change (if Option B)

Add a new endpoint in `main.py` after the existing message endpoints
(around line 870):

```python
@app.put("/api/conversations/{conversation_id}/messages/{message_id}")
def update_message(
    conversation_id: str,
    message_id: str,
    data: MessageCreate,
    user = Depends(get_current_user)
):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """UPDATE conversation_messages
           SET content = %s
           WHERE id = %s
             AND conversation_id = %s
             AND role = 'user'
           RETURNING id""",
        (data.message, message_id, conversation_id)
    )
    row = cursor.fetchone()
    conn.commit()
    cursor.close()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"success": True, "message": "Message updated"}
```

Note: only `role = 'user'` messages can be edited — we don't allow editing
AI responses.

### ⚠️ Question for you

Which edit behaviour does the frontend use — Option A (re-send) or
Option B (update stored message)? Ask your frontend colleague.
If Option A, skip this backend change entirely.

---

## Change 4 — Hard Delete Agent (Not Soft Deactivate)

### Current code (`main.py` lines 1198–1213)

```python
@app.delete("/admin/agents/{agent_id}")
def admin_delete_agent(agent_id: str, user = Depends(require_admin)):
    """Soft-delete: set is_active = false. Does NOT remove data or chunks."""
    cursor.execute(
        "UPDATE agents SET is_active = false, updated_at = NOW() WHERE id = %s",
        (agent_id,)
    )
    return {"success": True, "message": "Agent deactivated"}
```

This does a soft delete — sets `is_active = false` but keeps everything in
the database: the agent row, all document chunks, all user assignments.

### What needs to change

Change from `UPDATE` to `DELETE`. The database schema already has
`ON DELETE CASCADE` on both `document_chunks` and `user_agents`, so
deleting the agent automatically deletes all its chunks and assignments.

```python
@app.delete("/admin/agents/{agent_id}")
def admin_delete_agent(agent_id: str, user = Depends(require_admin)):
    """Hard delete — removes agent, all document chunks, and all assignments."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "DELETE FROM agents WHERE id = %s",
        (agent_id,)
    )
    found = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    if not found:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"success": True, "message": "Agent deleted"}
```

### What gets deleted automatically (CASCADE)

| Table | What happens |
|---|---|
| `agents` | Row deleted |
| `document_chunks` | All chunks for this agent deleted (CASCADE) |
| `user_agents` | All user assignments for this agent deleted (CASCADE) |
| `conversations.agent_id` | Set to NULL (SET NULL, not cascade) |

Conversations themselves are NOT deleted — they stay in history, just
without an agent reference.

### ⚠️ Warning — this is irreversible

Unlike the soft delete (which you could reverse with `SET is_active = true`),
a hard delete removes the agent and all its embedded document chunks
permanently. Make sure the frontend shows a confirmation dialog before
calling this endpoint.

### File to change

`webai-bridge/main.py` — only the `admin_delete_agent()` function, ~line 1198.

---

## Summary Table

| # | Change | File | Lines | Risk |
|---|---|---|---|---|
| 1 | Add models | `main.py` | ~887 | Low — just add list items |
| 2 | Logout disconnects Gemini | `main.py` | ~1034 | Low — reuses existing logic |
| 3 | Edit message endpoint | `main.py` | ~870 | Low — only if Option B needed |
| 4 | Hard delete agent | `main.py` | ~1198 | Medium — irreversible, confirm |

All 4 changes are in a single file: `webai-bridge/main.py`.
After changes: restart with `docker compose up --build bridge`.
No database schema changes needed for any of these.

---

## Your Answers Needed Before We Code

1. **Change 1** — Confirm the real model IDs WebAI-to-API accepts
2. **Change 2** — Option A (logout disconnects Gemini) or Option B (keep separate)?
3. **Change 3** — Option A (re-send) or Option B (update stored message)?
4. **Change 4** — Confirmed? (irreversible — want to proceed?)
