# Feature Plan: Roles, Permissions & Agent Management

> Generated after full codebase analysis — covers current state, what needs to be built, architecture decisions, and open questions.

---

## 1. Current State (What Already Exists)

### Stack
| Layer | Tech | Port |
|-------|------|------|
| Frontend | React 19 + TypeScript + Tailwind + Vite | 3000 |
| Bridge API | FastAPI (Python 3.11) — user/session management | 8000 |
| WebAI Engine | FastAPI (Python 3.12) — Gemini execution | 6969 |
| Database | PostgreSQL 16 | 5432 |

### What's Already Built
- User registration & login (JWT, bcrypt passwords)
- Per-user Gemini client instances (cookies encrypted in DB)
- Persistent conversations + messages (UUID-keyed, in PostgreSQL)
- Streaming chat via SSE
- OpenAI-compatible `/v1/chat/completions`
- Docker Compose full-stack deployment

### What's Missing (the entire task)
- **Roles** (admin vs user) — the `users` table has no role column today
- **Agents** — no agents table, no agent concept exists anywhere
- **Dataset** — no dataset storage or injection mechanism
- **Agent-to-User assignment** — no many-to-many relationship
- **Admin UI** — no protected admin area in the frontend
- **Conversation scoped to agent** — conversations track `model` but not `agent_id`

---

## 2. What Needs to Be Built

### 2.1 Roles & Permissions

**Two roles:**
- `admin` — can do everything a user can, plus manage agents
- `user` — can only chat with assigned agents, view own history

**Changes needed:**
- Add `role` column to `users` table (`TEXT DEFAULT 'user'`, values: `'admin'` / `'user'`)
- Bridge API middleware: role-guard decorator for admin-only endpoints
- Frontend: route guards that hide admin pages from regular users
- Seed/promote: a way to create the first admin (migration script or env var `ADMIN_EMAIL`)

---

### 2.2 Agents

An **agent** = a named Gemini persona with a dataset (system prompt / context) that is assigned to one or more users.

**New database table:**
```sql
agents
├── id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── name        TEXT NOT NULL
├── description TEXT                         -- shown to users
├── dataset     TEXT NOT NULL                -- the injected system prompt / context
├── model       TEXT DEFAULT 'gemini-3-flash'
├── created_by  INTEGER REFERENCES users(id) -- admin who created it
├── is_active   BOOLEAN DEFAULT true
├── created_at  TIMESTAMP DEFAULT NOW()
└── updated_at  TIMESTAMP DEFAULT NOW()
```

**Agent ↔ User assignment (many-to-many):**
```sql
user_agents
├── id         SERIAL PRIMARY KEY
├── user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE
├── agent_id   UUID REFERENCES agents(id) ON DELETE CASCADE
├── assigned_at TIMESTAMP DEFAULT NOW()
└── UNIQUE (user_id, agent_id)
```

**Conversations linked to agent:**
```sql
-- Add to existing conversations table:
ALTER TABLE conversations ADD COLUMN agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
```

---

### 2.3 Admin Endpoints (Bridge API — Port 8000)

All require `role = 'admin'` or they return `403 Forbidden`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/agents` | List all agents |
| POST | `/admin/agents` | Create new agent |
| GET | `/admin/agents/{id}` | Get single agent |
| PUT | `/admin/agents/{id}` | Edit agent (name, dataset, model, description) |
| DELETE | `/admin/agents/{id}` | Delete agent (soft or hard) |
| GET | `/admin/agents/{id}/users` | List users assigned to agent |
| POST | `/admin/agents/{id}/users` | Assign users to agent |
| DELETE | `/admin/agents/{id}/users/{user_id}` | Remove assignment |
| GET | `/admin/users` | List all users (with roles) |
| PUT | `/admin/users/{id}/role` | Change user role |

---

### 2.4 User Endpoints (additions to existing)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List agents assigned to me |
| GET | `/api/agents/{id}` | Get agent details (no dataset leak) |

> Chat endpoint `/api/chat` needs to accept `agent_id` and inject `dataset` as system prompt.

---

### 2.5 How Dataset Gets Injected Into Gemini

Current flow:
```
Frontend → /api/chat → Bridge → /internal/gemini/... → WebAI → Gemini
```

New flow with dataset:
```
Frontend sends agent_id in chat request
    ↓
Bridge fetches agent.dataset from DB
Bridge prepends dataset as system message in the messages array
    ↓
Sends enriched messages to WebAI → Gemini
```

This means **no changes needed in WebAI-to-API** — the dataset injection happens in the Bridge before forwarding. Clean separation.

---

### 2.6 Frontend Pages & Components

#### New Admin Pages
| Page | Route | What it does |
|------|-------|-------------|
| Admin Dashboard | `/admin` | Overview — agent count, user count |
| Agent List | `/admin/agents` | Table of all agents, create button |
| Create Agent | `/admin/agents/new` | Form: name, description, model, dataset textarea |
| Edit Agent | `/admin/agents/:id/edit` | Same form pre-filled |
| Assign Users | `/admin/agents/:id/assign` | Multi-select users, current assignments |
| User List | `/admin/users` | List users, role badge, change role button |

#### Changes to Existing Pages
| Page | Change |
|------|--------|
| Login | No change |
| Chat | Agent selector (only agents assigned to me), model auto-set from agent |
| Conversation History | Show agent name alongside conversation |
| Settings | No change |

#### Auth/Route Guards
- If `role === 'admin'` → show Admin link in sidebar
- All `/admin/*` routes redirect to home if not admin
- JWT payload should include `role` so frontend doesn't need an extra API call

---

## 3. Architecture Decision Points

### 3.1 Where does the dataset live?
**Recommended:** `TEXT` field in the `agents` table in PostgreSQL.

Alternatives considered:
- File upload (S3/disk): more complex, needed only if datasets are large binary files
- Separate `datasets` table: over-engineering unless one dataset can be shared across agents

### 3.2 How is dataset injected?
**Recommended:** Bridge prepends it as a `system` role message in the messages array before forwarding to WebAI.

This requires zero changes to the WebAI engine and Gemini already handles system messages well.

### 3.3 One agent per conversation or switchable?
**TBD — see Questions section.** Recommendation: agent is chosen at conversation creation, locked for the lifetime of that conversation (stored as `agent_id` on `conversations`).

### 3.4 Can a user chat without an agent?
**TBD — see Questions section.** If yes, fall back to raw Gemini with no system prompt. If no, user must always pick an agent.

### 3.5 First admin creation
**Recommended:** env var `ADMIN_EMAIL` in Bridge `.env`. On startup, if user with that email exists and has role `user`, promote to `admin`. Simple, no seed script needed.

---

## 4. Database Migration Plan

```sql
-- Step 1: Add role to users
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

-- Step 2: Promote first admin (run manually or via startup script)
UPDATE users SET role = 'admin' WHERE email = '<ADMIN_EMAIL>';

-- Step 3: Create agents table
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    dataset TEXT NOT NULL,
    model TEXT DEFAULT 'gemini-3-flash',
    created_by INTEGER REFERENCES users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Step 4: Create user_agents assignment table
CREATE TABLE user_agents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, agent_id)
);

-- Step 5: Link conversations to agents
ALTER TABLE conversations ADD COLUMN agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
```

---

## 5. JWT Token Change

Current payload:
```json
{ "sub": "user_id", "email": "...", "exp": "..." }
```

Add role so frontend can gate routes without extra round-trip:
```json
{ "sub": "user_id", "email": "...", "role": "admin", "exp": "..." }
```

---

## 6. File-by-File Change List

### `webai-bridge/database.py`
- Add `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`
- Add `CREATE TABLE agents (...)`
- Add `CREATE TABLE user_agents (...)`
- Add `ALTER TABLE conversations ADD COLUMN agent_id UUID`

### `webai-bridge/auth.py`
- Include `role` in JWT payload
- Add `require_admin` dependency function

### `webai-bridge/main.py`
- Add `/admin/agents` CRUD routes
- Add `/admin/users` routes
- Add `/api/agents` user-facing routes
- Update `/api/chat` to accept `agent_id`, fetch dataset, inject as system message
- Update `/api/conversations` POST to accept and store `agent_id`

### `webai-bridge/schemas/`
- Add `agents.py` (AgentCreate, AgentUpdate, AgentResponse)
- Update `users.py` to include `role`
- Update `conversations.py` to include `agent_id`

### `web2api-ui/src/`
- Add `/admin` route tree (Dashboard, Agents, Users pages)
- Update `AppShell.tsx` — show Admin nav only if admin
- Update Chat page — agent selector dropdown
- Update Conversation list — show agent name

---

## 7. Open Questions (Need Your Answers)

These directly affect the implementation. Please answer each one.

---

### Q1 — Dataset format: what exactly is the "dataset"?

> a) **Plain text / system prompt** — admin writes a text blob that gets prepended to every conversation as the AI's instructions (simplest)
>
> b) **File upload** — admin uploads a PDF/TXT/CSV and the system extracts + stores it
>
> c) **Structured Q&A pairs** — like a FAQ the agent should know
>
> d) **Multiple files / documents** — a knowledge base

This is the most important question. The answer changes the storage, upload UI, and injection mechanism significantly.

---

### Q2 — Can a user have zero agents assigned?

> a) No — users with no agent cannot chat at all (blocked with "ask admin to assign an agent")
>
> b) Yes — user falls back to a default raw Gemini chat with no system prompt

---

### Q3 — Can a user switch agent mid-conversation?

> a) No — agent is chosen when starting a conversation and locked
>
> b) Yes — user can switch agents and the new agent's dataset applies to subsequent messages in the same conversation

---

### Q4 — How many users can one agent be assigned to?

> a) Unlimited
>
> b) There's a max per agent
>
> c) An agent can only be assigned to one user at a time

---

### Q5 — Can a user see the agent's dataset / system prompt?

> a) No — it's internal/hidden (user just sees the agent name and description)
>
> b) Yes — user can see what dataset/instructions the agent has

---

### Q6 — Does each user need their own Gemini cookies, or does the admin's single Gemini account serve everyone?

> Currently the system is built for per-user Gemini cookies. With agents, it's unclear:
>
> a) Each user still connects their own Gemini account (existing flow)
>
> b) Admin connects one Gemini account and all users share it through their agents
>
> c) Admin can set a global Gemini cookie that is the fallback if the user has none

---

### Q7 — First admin: how do you want to create it?

> a) Promote via env var `ADMIN_EMAIL` on Bridge startup (recommended — no extra tooling)
>
> b) First registered user is always admin
>
> c) Manual SQL `UPDATE users SET role='admin' WHERE email='...'`
>
> d) A separate `/admin/setup` one-time endpoint (like an install wizard)

---

### Q8 — Soft delete or hard delete for agents?

> a) Soft delete — agent marked `is_active = false`, conversations referencing it still show the agent name
>
> b) Hard delete — agent removed from DB, conversations lose the agent reference (`agent_id` becomes NULL)

---

### Q9 — Should admin also be able to chat (use agents)?

> a) Yes — admin has all user capabilities, so they can also be assigned agents and chat
>
> b) Admin is purely management — they do not chat, only configure

---

### Q10 — Conversation history: can admin see all users' conversations?

> a) Yes — admin has a view of all conversations across all users
>
> b) No — admin only manages agents/users but cannot read user conversations

---

### Q11 — Do you want a single Gemini model per agent, or can users pick within the agent?

> a) Agent defines the model — user cannot change it
>
> b) Agent sets a default model but user can override from available models
>
> c) User always picks model freely regardless of agent

---

### Q12 — Frontend: existing design language

> The frontend uses Tailwind + Radix UI. For admin pages:
>
> a) Build in the same style as existing chat UI (consistent look)
>
> b) A separate, more "dashboard-like" admin panel with tables, badges, modals
>
> c) No preference — go with whatever is fastest to build

---

## 8. Estimated Scope

| Area | Effort |
|------|--------|
| DB migrations (roles + agents + assignments) | Small |
| Bridge: admin endpoints (CRUD agents, assign users) | Medium |
| Bridge: inject dataset into chat | Small |
| Bridge: role guard middleware | Small |
| Bridge: JWT role inclusion | Small |
| Frontend: admin pages (agent CRUD + assign) | Large |
| Frontend: user list + role management | Medium |
| Frontend: agent selector in chat | Small |
| Frontend: route guards | Small |
| **Total** | **Medium-Large** |

No changes needed to `WebAI-to-API` (port 6969) — dataset injection is handled entirely in the Bridge before forwarding.

---

*Fill in the answers to the questions above and we can move straight to implementation.*
