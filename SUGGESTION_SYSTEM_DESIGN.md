# Suggestion System — Design & Implementation Plan

**Date:** 2026-06-30
**Status:** Design only — no code written yet
**Author:** WebAI Bridge Team

---

## 1. What we are building (in plain words)

On the **Edit Agent** page (admin only), we add a **"Generate Suggestions"** button.

When the admin clicks it:
1. The button shows a **loading** state.
2. The backend takes the **documents already uploaded to that agent**, sends their content to **Gemini** (using our own Gemini account — *no API key*), and asks Gemini to write good **starter questions** that a user of this agent would likely ask.
3. When Gemini answers, a **popup** opens showing the suggested questions.
4. The admin can **edit** any question, **delete** any question, or **add** a new one.
5. When happy, the admin clicks **Approve & Save** → the questions are stored in the database.
6. Afterwards, any **user assigned to that agent** sees these questions as **quick-start chips** in the chat screen. Clicking one sends it as the first message — this shortcuts their workflow.

### The two goals
| Goal | How it is met |
|---|---|
| Use **our Gemini account**, not an API key | The bridge calls the existing WebAI-to-API service with the admin's `X-Internal-User-ID`, which uses that admin's connected Gemini cookies. |
| Suggestions come **from the uploaded file** | The file text is already stored in `document_chunks`. We rebuild the text from those chunks and put it in the Gemini prompt. |

---

## 2. How the current system works (the pieces we build on)

Understanding this is what makes the feature easy — almost everything we need already exists.

### 2.1 Documents are stored as TEXT, not files
When an admin uploads a `.pdf/.docx/.txt/.md` to an agent:
- `webai-bridge/vector.py` extracts the text, splits it into ~1500-char **chunks**, embeds each chunk via Ollama, and stores them in the **`document_chunks`** table.
- The **original file is NOT kept** — only the chunked text in the database.

➡️ **Consequence for us:** to "send the file to Gemini" we **rebuild the document text** by reading all rows in `document_chunks` for an agent, ordered by `filename, chunk_index`, and joining their `content`. No need to store files.

### 2.2 Gemini is called through WebAI-to-API (no API key)
- The bridge talks to the internal service at `http://webai:6969`.
- Chat goes to **`POST /v1/chat/completions`** with headers:
  - `X-Internal-Key: <WEBAI_INTERNAL_KEY>`
  - `X-Internal-User-ID: <user_id>` ← this picks **that user's** Gemini client (their cookies).
- WebAI-to-API uses the **`gemini-webapi`** library with the user's `__Secure-1PSID` / `__Secure-1PSIDTS` cookies — this is the "our Gemini account" path, no API key anywhere.

➡️ **Consequence for us:** the admin clicking "Generate Suggestions" **must have their Gemini connected** (cookies saved). We reuse the exact same call the normal chat already makes.

### 2.3 Agents, admin guard, and the edit page
- Agents live in the **`agents`** table (`id`, `name`, `instructions`, `model`, …).
- All admin routes use `Depends(require_admin)` in `webai-bridge/main.py`.
- The edit page is **`web2api-ui/src/components/admin/AgentDetailPage.tsx`** (route `/admin/agents/:agentId`).
- Admin state is in **Zustand** at `web2api-ui/src/stores/adminStore.ts`.
- Popups follow the pattern in `ConfirmDialog.tsx` / `AgentFormModal.tsx` (overlay + `glass-strong` card).
- Users see their assigned agents in the chat screen (`ChatHome.tsx`) via `GET /api/agents`.

---

## 3. Architecture & data flow

```
ADMIN side (generate + approve)
────────────────────────────────────────────────────────────────────────
 Edit Agent page  ──click "Generate Suggestions"──▶  Bridge
 (AgentDetailPage)                                   POST /admin/agents/{id}/suggestions/generate
                                                          │
                                                          │ 1. read document_chunks for agent
                                                          │    → rebuild document text
                                                          │ 2. build prompt: "write N starter questions"
                                                          │ 3. POST /v1/chat/completions  (WebAI-to-API)
                                                          │    headers: X-Internal-Key,
                                                          │             X-Internal-User-ID = admin id
                                                          ▼
                                                   WebAI-to-API ──▶ Gemini (admin's cookies)
                                                          │
                                                          ▼ Gemini returns text
                                                   parse into ["Q1", "Q2", ...]
                                                          │
              popup shows questions  ◀── JSON (NOT saved yet) ──┘
                     │
   admin edits / deletes / adds, then clicks "Approve & Save"
                     │
                     ▼
              PUT /admin/agents/{id}/suggestions   (body: {questions:[...]})
                     │
                     ▼
              agent_suggestions table  ← old rows replaced by approved list


USER side (consume)
────────────────────────────────────────────────────────────────────────
 Chat screen ──selects this agent──▶  GET /api/agents/{id}/suggestions
                                            │
                                            ▼
                                     approved questions
                                            │
                  shown as clickable chips ─┘
                  click → fills/sends as first message
```

**Important design choice — drafts are NOT stored.**
The `generate` endpoint returns questions as JSON only; it does **not** write to the DB. Editing happens in the browser. Only **Approve & Save** writes to the database. This keeps the DB clean (no half-finished drafts) and the logic simple.

---

## 4. Database changes

One new table. Nothing else changes. Add the `CREATE TABLE` to `init_db()` in `webai-bridge/database.py` (same place all other tables are created).

```sql
CREATE TABLE IF NOT EXISTS agent_suggestions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_suggestions_agent
    ON agent_suggestions (agent_id, sort_order);
```

**Why this shape:**
- `agent_id` + `ON DELETE CASCADE` → if an agent is hard-deleted, its suggestions go too (matches how `document_chunks` behaves).
- `sort_order` → preserves the order the admin approved them in (chips display in that order).
- No `is_approved` column needed — only approved questions are ever written here. "Save" = "approve".
- No `user_id` — suggestions belong to the **agent**, shared by all its users.

> Note: `agents` are **soft-deleted** today (`is_active=false`), so suggestions survive a soft delete — correct, because reactivating the agent should keep them.

---

## 5. Backend changes (`webai-bridge`)

### 5.1 New endpoints (add to `main.py`, next to the other `/admin/agents/{id}/...` routes)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /admin/agents/{agent_id}/suggestions/generate` | `require_admin` | Calls Gemini using the agent's documents, returns generated questions (NOT saved). |
| `GET  /admin/agents/{agent_id}/suggestions` | `require_admin` | Returns the currently saved suggestions (so the page shows what already exists). |
| `PUT  /admin/agents/{agent_id}/suggestions` | `require_admin` | Replaces saved suggestions with the approved list. |
| `GET  /api/agents/{agent_id}/suggestions` | `get_current_user` | User-facing: returns approved suggestions for an agent the user is assigned to. |

### 5.2 New service file: `webai-bridge/services/suggestion_service.py`
Keeps `main.py` thin (matches existing `conversation_service.py` / `message_service.py` pattern).

Responsibilities:
- `rebuild_agent_document_text(agent_id) -> str` — read `document_chunks`, order by `filename, chunk_index`, join `content`. Truncate to a safe size (see §7).
- `build_suggestion_prompt(agent_name, instructions, document_text, count) -> list[dict]` — produce the `messages` array for Gemini.
- `parse_questions(gemini_text) -> list[str]` — turn Gemini's reply into a clean list (see §6.2).
- `get_saved_suggestions(agent_id) -> list[dict]`
- `replace_suggestions(agent_id, questions: list[str]) -> None` — delete old rows, insert new ones with `sort_order`.

### 5.3 Generate endpoint — logic sketch
```python
@app.post("/admin/agents/{agent_id}/suggestions/generate")
async def generate_suggestions(agent_id: str, body: GenerateRequest,
                               user = Depends(require_admin)):
    agent = get_agent_or_404(agent_id)

    # 1. Rebuild document text from chunks
    doc_text = rebuild_agent_document_text(agent_id)
    if not doc_text.strip():
        # No documents — fall back to using the agent instructions only
        doc_text = ""

    # 2. Build the Gemini prompt
    messages = build_suggestion_prompt(
        agent_name=agent["name"],
        instructions=agent["instructions"],
        document_text=doc_text,
        count=body.count or 6,
    )

    # 3. Call WebAI-to-API using THIS ADMIN's Gemini client (their cookies)
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{WEBAI_URL}/v1/chat/completions",
            headers={
                "X-Internal-Key": WEBAI_INTERNAL_KEY,
                "X-Internal-User-ID": str(user["id"]),
            },
            json={"model": agent["model"], "stream": False, "messages": messages},
        )
    if resp.status_code != 200:
        raise HTTPException(502, "Gemini request failed. Is your Gemini connected?")

    # 4. Parse Gemini's text into a clean list of questions
    text = extract_completion_text(resp.json())
    questions = parse_questions(text)

    return {"questions": questions}   # NOT saved yet
```

### 5.4 Save (approve) endpoint — logic sketch
```python
@app.put("/admin/agents/{agent_id}/suggestions")
def save_suggestions(agent_id: str, body: SaveRequest,
                     user = Depends(require_admin)):
    get_agent_or_404(agent_id)
    cleaned = [q.strip() for q in body.questions if q.strip()][:20]  # cap at 20
    replace_suggestions(agent_id, cleaned)        # DELETE old, INSERT new
    return {"success": True, "count": len(cleaned)}
```

### 5.5 User-facing endpoint — logic sketch
```python
@app.get("/api/agents/{agent_id}/suggestions")
def my_agent_suggestions(agent_id: str, user = Depends(get_current_user)):
    assert_user_assigned_to_agent(user["id"], agent_id)   # reuse existing check
    return {"suggestions": get_saved_suggestions(agent_id)}
```

### 5.6 New Pydantic schemas (`webai-bridge/schemas/suggestions.py`)
```python
class GenerateRequest(BaseModel):
    count: int | None = 6

class SaveRequest(BaseModel):
    questions: list[str]

class SuggestionOut(BaseModel):
    id: str
    question: str
    sort_order: int
```

---

## 6. The Gemini prompt & parsing (the heart of quality)

### 6.1 Prompt design
We send a **system message** describing the job and a **user message** carrying the agent context + document text. Asking for a **strict JSON array** makes parsing reliable.

```
SYSTEM:
You generate starter questions for an AI assistant. Given the assistant's
purpose and its knowledge documents, produce the most useful questions a real
user would ask it. Questions must be answerable from the material, short, and
specific. Return ONLY a JSON array of strings, nothing else.

USER:
Assistant name: {agent_name}
Assistant purpose / instructions:
{instructions}

Knowledge documents:
\"\"\"
{document_text}   ← rebuilt from document_chunks, truncated
\"\"\"

Write {count} starter questions as a JSON array of strings.
```

### 6.2 Parsing strategy (robust)
Gemini returns free text, so parse defensively in `parse_questions()`:
1. **Try JSON first** — find the first `[` … last `]`, `json.loads` it, keep string items.
2. **Fallback to line parsing** — split on newlines, strip leading `1.`, `-`, `*`, `Q:` markers, drop empty lines.
3. **Clean up** — trim whitespace/quotes, drop duplicates, cap at `count`.

This way, whether Gemini returns a clean array or a numbered list, we still get a usable list.

---

## 7. Edge cases & limits

| Case | Handling |
|---|---|
| Admin has **no Gemini connected** | WebAI-to-API returns non-200 → bridge returns `502` with message "Connect your Gemini account first." Frontend shows it in the popup. |
| Agent has **no documents** | Generate from `instructions` only (still useful). Optionally show a hint "Add documents for better suggestions." |
| **Very large** documents | `rebuild_agent_document_text` truncates to a safe character budget (e.g. ~12,000 chars). Document this constant; pick the most relevant chunks first if needed. |
| Gemini returns **malformed** text | `parse_questions` falls back to line parsing; if still empty, return `{"questions": []}` and the popup shows "No suggestions produced, try again." |
| Gemini is **slow** | Use a generous `httpx` timeout (e.g. 120s) and a loading spinner; `stream:false` keeps it one request. |
| Admin **regenerates** | Generate is stateless — it never touches the DB. Saved suggestions only change on Approve & Save. |
| Duplicate questions | De-duplicated in `parse_questions` and again on save. |
| Save with empty list | Allowed — it clears all suggestions for the agent (chips disappear for users). |

---

## 8. Frontend changes (`web2api-ui`)

### 8.1 API layer — `src/services/api.ts` (add functions)
```ts
// Admin: generate (not saved)
export async function generateAgentSuggestions(token, agentId, count = 6)
  -> { questions: string[] }            // POST /admin/agents/{id}/suggestions/generate

// Admin: read currently saved
export async function getAgentSuggestions(token, agentId)
  -> { suggestions: {id,question,sort_order}[] }   // GET /admin/agents/{id}/suggestions

// Admin: approve & save
export async function saveAgentSuggestions(token, agentId, questions: string[])
  -> { success: boolean; count: number }           // PUT /admin/agents/{id}/suggestions

// User: read approved for an assigned agent
export async function getMyAgentSuggestions(token, agentId)
  -> { suggestions: {id,question}[] }              // GET /api/agents/{id}/suggestions
```
Reuse the existing `authHeaders(token)` helper and `BASE` config.

### 8.2 Admin store — `src/stores/adminStore.ts` (add state + actions)
```ts
// state
suggestionsByAgentId: Record<string, Suggestion[]>;
isGeneratingSuggestions: boolean;
isSavingSuggestions: boolean;

// actions
generateSuggestions: (agentId, count?) => Promise<string[]>;   // returns draft list
loadSuggestions: (agentId) => Promise<void>;
saveSuggestions: (agentId, questions: string[]) => Promise<void>;
```

### 8.3 New component — `src/components/admin/SuggestionsModal.tsx`
Follow the `AgentFormModal.tsx` / `ConfirmDialog.tsx` style (overlay + `glass-strong` card, ESC to close).

Contents:
- Header: "Suggested questions for {agent name}".
- A list of rows, each = an editable text input + a **delete** (trash) button.
- **"+ Add question"** button to append a blank row.
- Footer: **Cancel** and **Approve & Save** (shows "Saving…" while saving).
- The list is held in **local component state** (seeded from the generate result or from existing saved suggestions). Editing/deleting/adding only changes local state. **Approve & Save** calls `saveSuggestions(agentId, list)`.

### 8.4 Edit page — `src/components/admin/AgentDetailPage.tsx` (add a section)
- Add a **"Suggestions"** card (next to Knowledge Base / Assigned Users).
- Button **"Generate Suggestions"**:
  - On click → `isGeneratingSuggestions=true`, call `generateSuggestions(agentId)`.
  - On success → open `SuggestionsModal` seeded with the returned questions.
  - On error → show the error message (e.g. "Connect your Gemini account first").
- Also show the **currently saved** suggestions (read-only list) with an **"Edit"** button that opens the same modal seeded from saved data.

### 8.5 Chat screen — show chips to users (`src/components/.../ChatHome.tsx`)
- When a user selects an agent (existing `selectedAgentId` flow), call `getMyAgentSuggestions(token, agentId)`.
- Render the questions as **clickable chips** above the message input (only on an empty/new conversation).
- Clicking a chip → set it as the input text (or send immediately) using the existing `sendMessage` path.

---

## 9. Files to add / change (summary)

### Backend — `webai-bridge`
| File | Change |
|---|---|
| `database.py` | **Add** `agent_suggestions` table + index inside `init_db()`. |
| `schemas/suggestions.py` | **New** — `GenerateRequest`, `SaveRequest`, `SuggestionOut`. |
| `services/suggestion_service.py` | **New** — rebuild text, build prompt, parse, get/replace saved. |
| `main.py` | **Add** 4 endpoints (generate / get / save / user-facing). |

### Gemini wrapper — `WebAI-to-API`
| File | Change |
|---|---|
| — | **No changes.** We reuse `POST /v1/chat/completions` exactly as chat already does. |

### Frontend — `web2api-ui`
| File | Change |
|---|---|
| `src/services/api.ts` | **Add** 4 functions (§8.1). |
| `src/stores/adminStore.ts` | **Add** suggestion state + actions (§8.2). |
| `src/components/admin/SuggestionsModal.tsx` | **New** — editable popup (§8.3). |
| `src/components/admin/AgentDetailPage.tsx` | **Add** Suggestions section + button (§8.4). |
| `src/components/.../ChatHome.tsx` | **Add** suggestion chips for users (§8.5). |
| `src/types` (wherever `Agent` etc. live) | **Add** `Suggestion` type. |

### Database
| Object | Change |
|---|---|
| `agent_suggestions` | **New** table (auto-created by `init_db()` on next bridge start — no manual migration needed). |

---

## 10. Permissions & security

- **Generate / Get(admin) / Save** → `require_admin`. Non-admins get `403`.
- **User-facing get** → `get_current_user` **and** must be assigned to the agent (reuse the existing assignment check used by `/api/agents/{id}`). Prevents users from reading suggestions of agents they don't have.
- Gemini is called with the **admin's own** `X-Internal-User-ID` → only their connected account is used. No API key is introduced anywhere.
- Document text is sent to Gemini (the admin's account) — same trust boundary as normal chat, so no new data-exposure concern.

---

## 11. Suggested build order (phased)

1. **DB + backend save/get** — add table, `suggestion_service`, `GET`/`PUT` admin endpoints, user-facing `GET`. Test with hardcoded questions (no Gemini yet).
2. **Generate endpoint** — wire the Gemini call + parser. Test that clicking generate returns questions from a real agent's documents.
3. **Admin UI** — `SuggestionsModal` + button + saved list on `AgentDetailPage`.
4. **User UI** — chips in the chat screen.
5. **Polish** — loading/error states, empty-document hint, truncation limit, de-dup.

Each phase is independently testable.

---

## 12. Open questions to confirm with the manager

1. **Click behavior of a chip** — should it *fill* the input (user can edit before sending) or *send immediately*? (Recommend: fill the input.)
2. **How many** suggestions by default? (Recommend: 6, admin can add/remove.)
3. **Auto-regenerate** when documents change, or always manual? (Recommend: manual — admin clicks the button.)
4. **Whose Gemini account** generates — the admin clicking, or a fixed "service" account? (Current design: the admin's own connected Gemini. Confirm the admin will always have Gemini connected.)
