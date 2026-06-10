# Feature Plan
## Roles, Permissions & Agent Management

*Version 2 — Including Agent Instructions, Vector DB & External Auth (Laravel + NATS)*

---

## What Changed in Version 2

Three major additions were made on top of the original plan:

1. **Agent Instructions —** Agents now have a dedicated instructions field (separate from the knowledge/dataset). This is where the admin writes the agent's behavioral rules, tone, persona, and response format. Think of it as the personality layer on top of the knowledge layer.

2. **Vector Database —** Instead of storing the full dataset as one big text blob and injecting it every time, documents are stored as vector embeddings using pgvector (inside your existing PostgreSQL). At chat time, only the chunks semantically relevant to the user's message are fetched and injected. This scales well for large knowledge bases and stays within Gemini's context window.

3. **External Auth via Laravel + NATS —** Your users already exist in a Laravel-based auth system. Instead of a second registration flow, the Bridge listens on NATS for user events from Laravel (user.created, user.updated, user.deleted) and keeps its local PostgreSQL in sync. Login validates against Laravel's API. The Bridge becomes a read replica of user state.

---

## 1. Current State

### Tech Stack

| Layer | Technology | Port |
|-------|-----------|------|
| Frontend | React 19 + TypeScript + Tailwind + Vite | 3000 |
| Bridge API | FastAPI (Python 3.11) — user/session management | 8000 |
| WebAI Engine | FastAPI (Python 3.12) — Gemini execution | 6969 |
| Database | PostgreSQL 16 | 5432 |
| External Auth | Laravel (your org's auth system) | separate |
| Message Bus | NATS (used by Laravel for events) | 4222 |

### Already Built

- User registration & login (JWT, bcrypt passwords)
- Per-user Gemini client instances (cookies encrypted in DB)
- Persistent conversations + messages (UUID-keyed, PostgreSQL)
- Streaming chat via SSE
- OpenAI-compatible /v1/chat/completions
- Docker Compose full-stack deployment

### Still Missing

- Roles (admin vs user) — users table has no role column today
- Agents — no agent table or concept exists
- Agent Instructions — no structured instructions field
- Vector DB — no vector storage or semantic search for agent knowledge
- Dataset upload + chunking — no document ingestion pipeline
- Agent-to-User assignment — no many-to-many relationship
- Admin UI — no protected admin area in frontend
- Conversation scoped to agent — conversations track model but not agent_id
- External Auth sync — no connection to Laravel or NATS

---

## 2. Full Architecture

The diagram below shows how all pieces connect after everything is built:

```
FRONTEND (React :3000)
  Chat UI  |  Admin Panel  |  Agent Selector
       ↓  HTTP / SSE
BRIDGE API (FastAPI :8000)
  Auth → Role Guard → Route Handlers
  On chat: fetch instructions → vector search → build system prompt → forward
  NATS Subscriber: Laravel user events → sync local DB
       ↓                        ↓
WebAI (:6969)          PostgreSQL :5432
Gemini execution       users, agents, document_chunks
                       user_agents, conversations
                            ↑ NATS (:4222)
                       LARAVEL AUTH (source of truth)
```

---

## 3. What Needs to Be Built

### 3.1 Roles & Permissions

Two roles:

- **admin** — can do everything a user can, plus manage agents and users
- **user** — can only chat with assigned agents, view own conversation history

Changes needed:

- Add role column to users table (`TEXT DEFAULT 'user'`)
- Bridge API: `require_admin` FastAPI dependency for admin-only endpoints
- Frontend: route guards hiding `/admin/*` from non-admins
- Role comes from Laravel via NATS sync — Bridge does not manage who is admin

### 3.2 Agents (Updated Schema)

An agent = a named Gemini persona with:

- **instructions** — behavioral rules (tone, persona, response format) — always injected fully
- **documents** — knowledge base stored as vector chunks — injected selectively (only relevant chunks)
- **model** — which Gemini model to use

> **Key design:** instructions are short behavioral rules and always injected fully. Documents are large and injected selectively — only the top-K chunks semantically closest to the user's message are fetched at runtime.

**Database schema:**

```
agents
├── id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── name          TEXT NOT NULL
├── description   TEXT
├── instructions  TEXT NOT NULL   -- behavioral rules, ALWAYS injected
├── model         TEXT DEFAULT 'gemini-2.5-flash'
├── created_by    INTEGER REFERENCES users(id)
├── is_active     BOOLEAN DEFAULT true
├── created_at    TIMESTAMP DEFAULT NOW()
└── updated_at    TIMESTAMP DEFAULT NOW()
```

> **Note:** There is NO `dataset TEXT` column. The knowledge base now lives in `document_chunks` (see Section 3.3).

### 3.3 Vector Database for Agent Knowledge

**Why use a vector database?**

- Gemini has a context window limit — you cannot inject 100 pages of text per message
- Relevant chunks = better, more focused answers from the agent
- Scales to large knowledge bases without slowing down the chat flow

**pgvector — No new service needed**

Enable pgvector inside your existing PostgreSQL 16. No extra Docker service required.

```sql
-- Enable the extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Document chunks table
CREATE TABLE document_chunks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    filename     TEXT,
    chunk_index  INTEGER NOT NULL,
    content      TEXT NOT NULL,
    embedding    vector(768),   -- Gemini text-embedding dimension
    metadata     JSONB DEFAULT '{}',
    created_at   TIMESTAMP DEFAULT NOW()
);

-- Index for fast similarity search
CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

#### Document Upload Flow (Admin)

1. Admin uploads a file (PDF / TXT / DOCX) via the admin UI
2. Bridge extracts the raw text
3. Bridge splits text into chunks (~500 tokens each, ~50 token overlap)
4. For each chunk: calls Gemini Embeddings API → gets a 768-dim vector
5. Stores chunk text + vector in document_chunks table

#### Retrieval Flow (Chat Time)

1. User sends a message
2. Bridge embeds the message using Gemini Embeddings API
3. Bridge runs cosine similarity search: `SELECT content FROM document_chunks WHERE agent_id=? ORDER BY embedding <=> query LIMIT 5`
4. Top 5 chunks returned as context
5. Bridge builds system prompt = instructions + relevant chunks
6. Forwards enriched messages to WebAI → Gemini

### 3.4 External Auth: Laravel + NATS Integration

#### The Problem

Your users already exist in a Laravel auth system. You don't want two separate user databases. The Bridge needs to know about users to assign them to agents and enforce roles.

#### The Solution: NATS Event Sync

Laravel publishes events to NATS when users are created, updated, or deleted. The Bridge subscribes to these events and keeps its local users table in sync. The Bridge becomes a read replica of user state — it never creates or deletes users on its own.

#### NATS Event Contracts (agree with your Laravel team)

**Subject: user.created**
```json
{ "event": "user.created", "user_id": 42, "email": "alice@co.com",
  "name": "Alice", "role": "user", "timestamp": "..." }
```

**Subject: user.updated**
```json
{ "event": "user.updated", "user_id": 42, "email": "alice@co.com",
  "name": "Alice", "role": "admin", "timestamp": "..." }
```

**Subject: user.deleted**
```json
{ "event": "user.deleted", "user_id": 42, "timestamp": "..." }
```

> Coordinate with your Laravel team on the exact event format. If they already publish to NATS with a different structure, the Bridge subscriber just needs to map the fields.

#### Updated Login Flow

1. User submits email + password in the frontend
2. Bridge calls Laravel Auth API: `POST /api/auth/validate { email, password }`
3. Laravel responds: `{ valid: true, user_id: 42, role: 'user' }`
4. Bridge issues its own JWT (with user_id + role)
5. Frontend uses Bridge JWT for all subsequent requests

This means you remove bcrypt password storage from the Bridge entirely. The Bridge trusts Laravel for authentication and NATS for user state.

> ⚠️ **If NATS goes down:** the Bridge works in degraded mode — existing users in the local DB can still log in and chat. New users from Laravel won't sync until NATS reconnects. Add `/health/nats` to monitor this.

---

## 4. Database Migration Plan

```sql
-- Step 1: Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: Add role and external sync fields to users
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN external_id INTEGER UNIQUE;  -- Laravel user_id
ALTER TABLE users ADD COLUMN synced_at TIMESTAMP;         -- last NATS sync

-- Step 3: Create agents table (instructions, no dataset column)
CREATE TABLE agents ( ... );   -- see Section 3.2

-- Step 4: Create document_chunks table (vector storage)
CREATE TABLE document_chunks ( ... );   -- see Section 3.3
CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops);

-- Step 5: Create user_agents assignment table
CREATE TABLE user_agents (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, agent_id)
);

-- Step 6: Link conversations to agents
ALTER TABLE conversations ADD COLUMN agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
```

---

## 5. API Endpoints

### 5.1 Admin Endpoints (require role = admin)

| Method | Path | Description |
|--------|------|-------------|
| GET | /admin/agents | List all agents |
| POST | /admin/agents | Create agent (name, instructions, model, description) |
| GET | /admin/agents/{id} | Get single agent |
| PUT | /admin/agents/{id} | Edit agent |
| DELETE | /admin/agents/{id} | Soft-delete (is_active = false) |
| POST | /admin/agents/{id}/documents | Upload doc → chunk → embed → store |
| GET | /admin/agents/{id}/documents | List documents for agent |
| DELETE | /admin/agents/{id}/documents/{doc_id} | Delete document and its chunks |
| GET | /admin/agents/{id}/users | List users assigned to agent |
| POST | /admin/agents/{id}/users | Assign users to agent |
| DELETE | /admin/agents/{id}/users/{user_id} | Remove user assignment |
| GET | /admin/users | List all users (synced from NATS) |
| PUT | /admin/users/{id}/role | Change user role |

### 5.2 User Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/agents | List agents assigned to me |
| GET | /api/agents/{id} | Get agent details (instructions not exposed) |

### 5.3 Auth & Health Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/login | Validate via Laravel, return Bridge JWT |
| GET | /health/nats | NATS connection status |

---

## 6. Chat Flow with Agent + Vector Search

Step-by-step of what happens when a user sends a message:

1. Frontend sends: `POST /api/chat { agent_id: 'uuid', messages: [...], stream: true }`
2. Bridge verifies JWT, extracts user_id
3. Bridge checks: is this user assigned to this agent? If not → 403 Forbidden
4. Bridge fetches agent instructions and model from the agents table
5. Bridge embeds the latest user message using Gemini Embeddings API (returns a 768-dim vector)
6. Bridge runs vector similarity search: `SELECT content FROM document_chunks WHERE agent_id=? ORDER BY embedding <=> query_vector LIMIT 5`
7. Bridge builds the system prompt by combining instructions + top 5 relevant chunks
8. Bridge prepends the system prompt as a system-role message in the messages array
9. Bridge forwards the enriched messages to WebAI (port 6969) — NO changes needed in WebAI
10. WebAI streams the Gemini response back to Bridge → Bridge streams to Frontend via SSE

> The WebAI engine (port 6969) requires zero changes. All new logic — instructions injection, vector search, NATS sync — lives entirely in the Bridge.

---

## 7. JWT Token Update

**Current payload:**
```json
{ "sub": "user_id", "email": "...", "exp": "..." }
```

**New payload** (add role so frontend can gate routes without extra round-trip):
```json
{ "sub": "user_id", "email": "...", "role": "admin", "exp": "..." }
```

---

## 8. Frontend Pages & Components

### New Admin Pages

| Page | Route | What it does |
|------|-------|--------------|
| Admin Dashboard | /admin | Agent count, user count, NATS health status |
| Agent List | /admin/agents | Table of all agents, create button |
| Create Agent | /admin/agents/new | Form: name, description, model, instructions textarea |
| Edit Agent | /admin/agents/:id/edit | Same form pre-filled |
| Agent Documents | /admin/agents/:id/documents | Upload files, list uploaded docs, delete |
| Assign Users | /admin/agents/:id/assign | Multi-select users, current assignments |
| User List | /admin/users | List synced users from NATS, role badge |

### Changes to Existing Pages

| Page | Change |
|------|--------|
| Login | Passes credentials to Bridge, which forwards to Laravel — no visual change |
| Chat | Agent selector dropdown (only agents assigned to me), model auto-set from agent |
| Conversation History | Show agent name alongside each conversation |
| Settings | Remove Gemini cookie setup if using admin-shared Gemini account |

---

## 9. File-by-File Change List

### Bridge API (webai-bridge/)

| File | What Changes |
|------|-------------|
| database.py | Run all 6 migration steps; add upsert_user() and delete_user() functions for NATS sync |
| nats_sync.py (NEW) | NATS subscriber background task; handles user.created, user.updated, user.deleted; calls upsert_user / delete_user |
| vector.py (NEW) | chunk_text(), embed_text() via Gemini, search_chunks() via pgvector, ingest_document() orchestrator |
| auth.py | Remove local bcrypt validation; add validate_with_laravel(); include role in JWT; add require_admin dependency |
| main.py | Add all admin + user agent routes; update /api/chat for vector search + system prompt; add /auth/login Laravel flow; add /health/nats; start NATS sync on startup |
| schemas/agents.py (NEW) | AgentCreate, AgentUpdate, AgentResponse (with instructions, no dataset) |
| schemas/documents.py (NEW) | DocumentUploadResponse, DocumentChunkResponse |
| schemas/users.py | Add role and external_id fields |
| schemas/conversations.py | Add agent_id field |
| docker-compose.yml | Add NATS service (or point to existing); add NATS_URL and LARAVEL_AUTH_URL env vars |

### Frontend (web2api-ui/src/)

| File / Area | What Changes |
|-------------|-------------|
| src/pages/admin/ (NEW) | Dashboard, AgentList, CreateAgent, EditAgent, AgentDocuments, AssignUsers, UserList pages |
| AppShell.tsx | Show Admin nav link if JWT role === 'admin' |
| Chat page | Add agent selector dropdown (filtered to assigned agents only) |
| Conversation list | Show agent name alongside each conversation |
| Router config | Add /admin/* route tree with role guard |

---

## 10. Open Questions — Answer Before Implementation

> ⚠️ These questions affect implementation decisions. Get answers from your team before starting development.

### Auth & Integration

**Q1 — What NATS event format does Laravel currently publish?**
Share the actual subjects and payload structure so the Bridge subscriber can map fields correctly.

**Q2 — What is the Laravel Auth API endpoint and response format?**
What URL does it expect? Does it return just a user ID or also the role?

### Agent Behavior

**Q3 — What document types should the knowledge base support?**
- a) Plain text / markdown only (simplest — no parsing libraries needed)
- b) PDF + TXT + DOCX (requires text extraction)
- c) Web URLs (crawl and chunk page content)

**Q4 — Who manages the Gemini account used for embeddings and chat?**
- a) Admin connects one Gemini account — used for all embeddings and all chats
- b) Each user still connects their own account for chat; admin account used only for embeddings

### User Experience

**Q5 — Can a user chat without an assigned agent?**
- a) No — blocked with "ask admin to assign you an agent"
- b) Yes — falls back to raw Gemini with no instructions

**Q6 — Can a user see the agent's instructions?**
- a) No — hidden; user only sees agent name and description
- b) Yes — transparent to the user

**Q7 — Agent per conversation or switchable mid-conversation?**
- a) Agent chosen at conversation start, locked for its lifetime (recommended)
- b) User can switch agents mid-conversation

### Admin & Management

**Q8 — Can admin also chat (use agents)?**
- a) Yes — admin has full user capabilities in addition to management
- b) No — admin is management-only, does not chat

**Q9 — Soft delete or hard delete for agents?**
- a) Soft — is_active = false, old conversations still show agent name
- b) Hard — agent removed, old conversations lose the agent reference

**Q10 — Should admin see all users' conversation history?**
- a) Yes
- b) No — admin manages agents/users but cannot read conversations

---

## 11. Estimated Scope

| Area | Effort | Notes |
|------|--------|-------|
| DB migrations | Small | pgvector + new tables |
| NATS subscriber + user sync | Medium | New background task; need to agree format with Laravel team first |
| Laravel auth integration | Small–Medium | Depends on their API shape |
| Vector ingestion pipeline | Medium | Chunking + embedding + storage |
| Vector search at chat time | Small | One SQL query + embed call |
| Bridge: admin agent CRUD | Medium | Standard CRUD |
| Bridge: document upload endpoint | Medium | File parsing + chunking + embedding |
| Bridge: role guard middleware | Small | |
| Bridge: JWT role inclusion | Small | |
| Frontend: admin pages | Large | Agent CRUD + document upload + user assign |
| Frontend: user list | Medium | Read-only — synced from NATS |
| Frontend: agent selector in chat | Small | |
| Frontend: route guards | Small | |
| **Total** | **Large** | Main complexity: NATS sync + vector pipeline |

> No changes needed to WebAI-to-API (port 6969). All new logic lives in the Bridge. **Critical path:** (1) agree on NATS format + Laravel auth API → (2) DB migrations → (3) NATS sync + auth switch → (4) vector pipeline → (5) agent CRUD + admin UI → (6) chat flow update → (7) frontend.
