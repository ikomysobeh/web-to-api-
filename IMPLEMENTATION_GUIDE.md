# Implementation Guide — Roles, Agents, Vector DB & NATS Auth

> Full technical guide for everything that needs to be built, changed, or created.
> Read this top-to-bottom before writing any code.

---

## Table of Contents

1. [What We Are Building — Summary](#1-what-we-are-building--summary)
2. [Critical Path — Do This In Order](#2-critical-path--do-this-in-order)
3. [New Packages to Install](#3-new-packages-to-install)
4. [Database Changes](#4-database-changes)
5. [New Files to Create](#5-new-files-to-create)
6. [Files to Modify — Backend](#6-files-to-modify--backend)
7. [Files to Modify — Frontend](#7-files-to-modify--frontend)
8. [Docker Compose Changes](#8-docker-compose-changes)
9. [Environment Variables](#9-environment-variables)
10. [New API Endpoints Reference](#10-new-api-endpoints-reference)
11. [The Full Chat Flow After Changes](#11-the-full-chat-flow-after-changes)
12. [What Does NOT Change](#12-what-does-not-change)
13. [Open Questions — Must Answer Before Starting](#13-open-questions--must-answer-before-starting)

---

## 1. What We Are Building — Summary

| Feature | What it means in code |
|---------|----------------------|
| **Roles** | Add `role` column to `users` table. Admin-only routes protected by a `require_admin` FastAPI dependency |
| **Agents** | New `agents` table with `name`, `description`, `instructions`, `model`. Admin creates and manages them |
| **Agent Instructions** | Short behavioral rules stored in `agents.instructions`. Always injected as system prompt header |
| **Vector Knowledge Base** | Documents uploaded by admin → chunked → embedded via Gemini API → stored in `document_chunks` table with pgvector. At chat time, top-5 relevant chunks fetched and injected |
| **Agent-User Assignment** | `user_agents` join table. Users only see agents assigned to them |
| **NATS User Sync** | Bridge subscribes to NATS JetStream topics `auth.v1.user.created`, `auth.v1.user.updated`, `auth.v1.user.deleted`. Messages are wrapped in **CloudEvents v1.0** envelope — real payload is inside `envelope["data"]` |
| **Laravel Auth** | Login no longer validates password in Bridge. Bridge calls Laravel's auth API to validate, then issues its own JWT |
| **JWT Role** | JWT payload now includes `role` so frontend can gate routes without extra API call |

---

## 2. Critical Path — Do This In Order

```
Step 1 — Confirm open questions with Laravel team (see Section 13 at the bottom)
         → We now know the NATS format, subject names, and login endpoint
         → A few small details still need confirmation before starting

Step 2 — Database migrations
         → All other code depends on the new tables existing

Step 3 — Auth changes
         → Update auth.py (Laravel validation + role in JWT)
         → Test login works before touching anything else

Step 4 — NATS sync
         → nats_sync.py + docker-compose NATS service
         → Verify users sync from Laravel before building agent assignment

Step 5 — Vector pipeline
         → vector.py (chunking + embedding + search)
         → Test document upload and similarity search independently

Step 6 — Agent CRUD + admin endpoints
         → Admin can create agents, upload documents, assign users

Step 7 — Chat flow update
         → main.py /api/chat updated to inject instructions + vector chunks

Step 8 — Frontend
         → Build admin pages last because they depend on all backend routes existing
```

---

## 3. New Packages to Install

**File to change:** `webai-bridge/requirements.txt`

Add these lines to the bottom of the file:

```
# NATS messaging client
nats-py==2.9.0

# pgvector Python adapter (for vector type in psycopg2)
pgvector==0.3.6

# File upload support for FastAPI
python-multipart==0.0.20

# PDF text extraction
pypdf==5.1.0

# DOCX text extraction
python-docx==1.1.2

# Async file handling
aiofiles==24.1.0
```

> **Note on embeddings:** We call the Gemini Embeddings REST API using `httpx` which is already installed. No extra Google SDK needed.

**Full updated requirements.txt will look like:**
```
fastapi==0.136.3
uvicorn==0.49.0
httpx==0.28.1
pydantic>=2.12,<3
python-dotenv==1.2.2
psycopg2-binary==2.9.10
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
bcrypt==4.1.3
browser-cookie3==0.20.1
annotated-types==0.7.0
anyio==4.13.0
certifi==2026.5.20
click==8.4.1
colorama==0.4.6
h11==0.16.0
httpcore==1.0.9
idna==3.18
lz4==4.4.5
pycryptodomex==3.23.0
typing_extensions==4.15.0
configparser==7.2.0
# New additions
nats-py==2.9.0
pgvector==0.3.6
python-multipart==0.0.20
pypdf==5.1.0
python-docx==1.1.2
aiofiles==24.1.0
```

---

## 4. Database Changes

**File to change:** `webai-bridge/database.py`

The `init_db()` function runs on every startup. Add all new migration SQL inside it. Each block uses `IF NOT EXISTS` or `IF NOT EXISTS` style so it is safe to run multiple times.

### 4.1 What to add to `init_db()` — exact SQL blocks

Add these after the existing `user_preferences` table creation:

```python
# --- NEW STEP 1: Enable pgvector extension ---
cursor.execute("CREATE EXTENSION IF NOT EXISTS vector")

# --- NEW STEP 2: Add role and external sync columns to users ---
# These use DO blocks so they only add if column doesn't exist
cursor.execute("""
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='users' AND column_name='role'
        ) THEN
            ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
        END IF;
    END$$;
""")

cursor.execute("""
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='users' AND column_name='external_id'
        ) THEN
            ALTER TABLE users ADD COLUMN external_id INTEGER UNIQUE;
        END IF;
    END$$;
""")

cursor.execute("""
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='users' AND column_name='synced_at'
        ) THEN
            ALTER TABLE users ADD COLUMN synced_at TIMESTAMP;
        END IF;
    END$$;
""")

# --- NEW STEP 3: agents table ---
cursor.execute("""
    CREATE TABLE IF NOT EXISTS agents (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name         TEXT NOT NULL,
        description  TEXT,
        instructions TEXT NOT NULL DEFAULT '',
        model        TEXT DEFAULT 'gemini-2.5-flash',
        created_by   INTEGER REFERENCES users(id),
        is_active    BOOLEAN DEFAULT true,
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW()
    )
""")

# --- NEW STEP 4: document_chunks table (vector storage) ---
cursor.execute("""
    CREATE TABLE IF NOT EXISTS document_chunks (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        filename    TEXT,
        chunk_index INTEGER NOT NULL,
        content     TEXT NOT NULL,
        embedding   vector(768),
        metadata    JSONB DEFAULT '{}',
        created_at  TIMESTAMP DEFAULT NOW()
    )
""")

# Index for fast cosine similarity search
cursor.execute("""
    CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
    ON document_chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
""")

# --- NEW STEP 5: user_agents assignment table ---
cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_agents (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        assigned_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (user_id, agent_id)
    )
""")

# --- NEW STEP 6: add agent_id to conversations ---
cursor.execute("""
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='conversations' AND column_name='agent_id'
        ) THEN
            ALTER TABLE conversations
            ADD COLUMN agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
        END IF;
    END$$;
""")
```

### 4.2 New helper functions to add to `database.py`

These are called by `nats_sync.py` to keep users in sync with Laravel:

```python
def upsert_user(external_id: int, email: str, role: str = "user") -> dict:
    """
    Insert or update a user coming from a NATS event from Laravel.
    external_id = the user's ID in the Laravel database.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO users (email, password_hash, role, external_id, synced_at)
        VALUES (%s, %s, %s, %s, NOW())
        ON CONFLICT (external_id) DO UPDATE
        SET email      = EXCLUDED.email,
            role       = EXCLUDED.role,
            synced_at  = NOW()
        RETURNING id, email, role, external_id
    """, (email, "EXTERNAL_AUTH", role, external_id))
    row = cursor.fetchone()
    conn.commit()
    cursor.close()
    conn.close()
    return dict(row)


def delete_user_by_external_id(external_id: int) -> bool:
    """
    Delete a user from local DB when Laravel sends user.deleted event.
    Cascade deletes their conversations, messages, and assignments.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "DELETE FROM users WHERE external_id = %s", (external_id,)
    )
    deleted = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return deleted
```

> **Note on `password_hash`:** Users synced from NATS get a placeholder `"EXTERNAL_AUTH"` as their password hash. The Bridge never uses this value for validation — it calls Laravel instead. This value just satisfies the `NOT NULL` constraint.

---

## 5. New Files to Create

### 5.1 `webai-bridge/nats_sync.py` — NATS subscriber

**Purpose:** Runs as a background task on Bridge startup. Listens for user events from Laravel and keeps the local `users` table in sync.

**What we know from reading the Laravel code:**
- Stream name: `AUTH_EVENTS`
- Subject pattern: `auth.v1.>` (all auth events)
- User subjects: `auth.v1.user.created` / `auth.v1.user.updated` / `auth.v1.user.deleted`
- Role change subjects: `auth.v1.assignment.role.assigned` / `auth.v1.assignment.role.removed`
- Every message is a **CloudEvents v1.0** envelope — the actual user data is inside `envelope["data"]`
- Roles arrive as a **list of strings**: `data["roles"] = ["admin"]`
- Laravel user ID field is `data["user_id"]` (integer)

**CloudEvents envelope shape (every NATS message looks like this):**
```json
{
  "specversion": "1.0",
  "id": "01JXXXXXXXXXXXXXXXX",
  "type": "auth.v1.user.created",
  "source": "auth-system",
  "subject": "user/42",
  "time": "2025-01-15T10:30:00Z",
  "datacontenttype": "application/json",
  "data": {
    "user_id": 42,
    "name": "Alice Smith",
    "email": "alice@example.com",
    "roles": ["user"]
  },
  "meta": {
    "correlation_id": "some-uuid",
    "actor_user_id": 1
  }
}
```

**Full file content:**

```python
# nats_sync.py
import asyncio
import json
import logging
import os
from nats.aio.client import Client as NATS
from database import upsert_user, delete_user_by_external_id

logger = logging.getLogger("nats-sync")
NATS_URL  = os.getenv("NATS_URL",  "nats://localhost:4222")
NATS_TOKEN = os.getenv("NATS_TOKEN", "")   # optional — set if Laravel NATS uses token auth

# Track connection state so /health/nats can report it
nats_connected = False

# Laravel role names that map to Bridge "admin"
ADMIN_ROLES = {"super-admin", "admin"}


def _extract_bridge_role(roles: list) -> str:
    """
    Map a list of Laravel role names to a single Bridge role.
    If any role in the list is admin-level → "admin", otherwise → "user".
    """
    for r in roles:
        if r in ADMIN_ROLES:
            return "admin"
    return "user"


def _unwrap(msg) -> dict:
    """
    Parse a NATS message and unwrap the CloudEvents envelope.
    Returns the inner data dict.
    Raises ValueError if the envelope is malformed.
    """
    envelope = json.loads(msg.data.decode())
    if "data" not in envelope:
        raise ValueError(f"CloudEvents envelope missing 'data' field: {envelope}")
    return envelope["data"], envelope.get("type", "unknown")


# ─── Event Handlers ──────────────────────────────────────────────────────────

async def handle_user_created(msg):
    """auth.v1.user.created → INSERT or UPDATE user in local DB"""
    try:
        data, event_type = _unwrap(msg)
        logger.info(f"NATS {event_type}: user_id={data.get('user_id')} email={data.get('email')}")
        upsert_user(
            external_id=data["user_id"],
            email=data["email"],
            role=_extract_bridge_role(data.get("roles", []))
        )
    except Exception:
        logger.exception("Failed to handle user.created event")


async def handle_user_updated(msg):
    """auth.v1.user.updated → UPDATE email and role in local DB"""
    try:
        data, event_type = _unwrap(msg)
        logger.info(f"NATS {event_type}: user_id={data.get('user_id')} roles={data.get('roles')}")
        upsert_user(
            external_id=data["user_id"],
            email=data["email"],
            role=_extract_bridge_role(data.get("roles", []))
        )
    except Exception:
        logger.exception("Failed to handle user.updated event")


async def handle_user_deleted(msg):
    """auth.v1.user.deleted → DELETE user from local DB (cascades to conversations, assignments)"""
    try:
        data, event_type = _unwrap(msg)
        logger.info(f"NATS {event_type}: user_id={data.get('user_id')}")
        deleted = delete_user_by_external_id(data["user_id"])
        logger.info(f"User removed from local DB: user_id={data['user_id']}, found={deleted}")
    except Exception:
        logger.exception("Failed to handle user.deleted event")


async def handle_role_changed(msg):
    """
    auth.v1.assignment.role.assigned / role.removed
    Role list is not in this event — we re-use upsert_user but only update role.
    Data shape: { "user_id": 42, "role": "admin", "store_id": null }
    """
    try:
        data, event_type = _unwrap(msg)
        logger.info(f"NATS {event_type}: user_id={data.get('user_id')} role={data.get('role')}")
        # We only have the single changed role here, not the full list.
        # Use the event type to decide direction:
        #   assigned → if this role is admin-level, promote
        #   removed  → demote to user (safe fallback — next full sync will correct)
        if "assigned" in event_type:
            role_name = data.get("role", "user")
            bridge_role = "admin" if role_name in ADMIN_ROLES else "user"
        else:
            bridge_role = "user"

        # Update only the role — keep email from existing record
        from database import get_connection
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET role = %s, synced_at = NOW() WHERE external_id = %s",
            (bridge_role, data["user_id"])
        )
        conn.commit()
        cursor.close()
        conn.close()
    except Exception:
        logger.exception("Failed to handle role change event")


# ─── Main subscriber task ─────────────────────────────────────────────────────

async def start_nats_sync():
    """
    Connect to NATS and subscribe to user events from Laravel.
    Runs forever as a background asyncio task.
    Auto-reconnects on disconnect.
    """
    global nats_connected
    nc = NATS()

    async def disconnected_cb():
        global nats_connected
        nats_connected = False
        logger.warning("NATS disconnected — user sync paused")

    async def reconnected_cb():
        global nats_connected
        nats_connected = True
        logger.info("NATS reconnected — user sync resumed")

    async def error_cb(e):
        logger.error(f"NATS error: {e}")

    connect_kwargs = dict(
        disconnected_cb=disconnected_cb,
        reconnected_cb=reconnected_cb,
        error_cb=error_cb,
        max_reconnect_attempts=-1,   # retry forever
    )
    if NATS_TOKEN:
        connect_kwargs["token"] = NATS_TOKEN

    try:
        await nc.connect(NATS_URL, **connect_kwargs)
        nats_connected = True
        logger.info(f"NATS connected: {NATS_URL}")

        # Real subject names from Laravel (auth.v1.* pattern)
        await nc.subscribe("auth.v1.user.created",              cb=handle_user_created)
        await nc.subscribe("auth.v1.user.updated",              cb=handle_user_updated)
        await nc.subscribe("auth.v1.user.deleted",              cb=handle_user_deleted)
        await nc.subscribe("auth.v1.assignment.role.assigned",  cb=handle_role_changed)
        await nc.subscribe("auth.v1.assignment.role.removed",   cb=handle_role_changed)

        logger.info("Subscribed to auth.v1.user.* and auth.v1.assignment.role.* events")

        while True:
            await asyncio.sleep(30)

    except Exception:
        nats_connected = False
        logger.exception("NATS sync failed to start")


def get_nats_status() -> bool:
    """Returns True if currently connected to NATS. Used by /health/nats."""
    return nats_connected
```

---

### 5.2 `webai-bridge/vector.py` — Vector pipeline

**Purpose:** All logic for chunking text, generating embeddings, storing in pgvector, and searching at chat time.

**Full file content:**

```python
# vector.py
import httpx
import json
import logging
import os
import re
import uuid
from typing import List, Optional
from database import get_connection

logger = logging.getLogger("vector")

# Gemini Embeddings API
# Uses the same Gemini API key the admin configured for their account
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
EMBED_MODEL = "models/text-embedding-004"   # produces 768-dim vectors
EMBED_URL = f"https://generativelanguage.googleapis.com/v1beta/{EMBED_MODEL}:embedContent?key={GEMINI_API_KEY}"

CHUNK_SIZE = 1500      # characters per chunk (~375 tokens at 4 chars/token)
CHUNK_OVERLAP = 150    # overlap between chunks


# ─── Text Chunking ───────────────────────────────────────────────────────────

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """
    Split text into overlapping chunks.
    Tries to split on sentence boundaries first (period+space).
    Falls back to hard character split.
    Returns a list of strings.
    """
    text = text.strip()
    if not text:
        return []

    # Split on sentence boundaries
    sentences = re.split(r'(?<=[.!?])\s+', text)

    chunks = []
    current = ""

    for sentence in sentences:
        if len(current) + len(sentence) + 1 <= chunk_size:
            current = current + " " + sentence if current else sentence
        else:
            if current:
                chunks.append(current.strip())
            # If a single sentence is longer than chunk_size, hard-split it
            if len(sentence) > chunk_size:
                for i in range(0, len(sentence), chunk_size - overlap):
                    chunks.append(sentence[i:i + chunk_size])
                current = ""
            else:
                current = sentence

    if current:
        chunks.append(current.strip())

    return [c for c in chunks if c]


# ─── Embedding ───────────────────────────────────────────────────────────────

async def embed_text(text: str) -> Optional[List[float]]:
    """
    Call Gemini Embeddings API and return a 768-dimension vector.
    Returns None if the call fails.
    """
    if not GEMINI_API_KEY:
        logger.error("GEMINI_API_KEY not set — cannot generate embeddings")
        return None

    payload = {
        "model": EMBED_MODEL,
        "content": {"parts": [{"text": text}]},
        "taskType": "RETRIEVAL_DOCUMENT"
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(EMBED_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["embedding"]["values"]
    except Exception:
        logger.exception(f"Embedding API call failed for text: {text[:80]}...")
        return None


async def embed_query(text: str) -> Optional[List[float]]:
    """
    Same as embed_text but uses RETRIEVAL_QUERY task type.
    Use this when embedding the user's question at chat time.
    """
    if not GEMINI_API_KEY:
        return None

    payload = {
        "model": EMBED_MODEL,
        "content": {"parts": [{"text": text}]},
        "taskType": "RETRIEVAL_QUERY"
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(EMBED_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["embedding"]["values"]
    except Exception:
        logger.exception("Query embedding failed")
        return None


# ─── Storage ─────────────────────────────────────────────────────────────────

def store_chunk(agent_id: str, filename: str, chunk_index: int, content: str, embedding: List[float]) -> str:
    """
    Insert a single chunk + vector into document_chunks.
    Returns the new chunk's UUID.
    """
    chunk_id = str(uuid.uuid4())
    embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO document_chunks (id, agent_id, filename, chunk_index, content, embedding)
        VALUES (%s, %s, %s, %s, %s, %s::vector)
    """, (chunk_id, agent_id, filename, chunk_index, content, embedding_str))
    conn.commit()
    cursor.close()
    conn.close()
    return chunk_id


# ─── Ingestion Orchestrator ───────────────────────────────────────────────────

async def ingest_document(agent_id: str, filename: str, text: str) -> dict:
    """
    Full pipeline: text → chunks → embeddings → store.
    Returns a summary: how many chunks were stored, how many failed.
    """
    chunks = chunk_text(text)
    logger.info(f"Ingesting '{filename}' for agent {agent_id}: {len(chunks)} chunks")

    stored = 0
    failed = 0

    for i, chunk_content in enumerate(chunks):
        embedding = await embed_text(chunk_content)
        if embedding is None:
            logger.warning(f"Chunk {i} embedding failed — skipping")
            failed += 1
            continue
        store_chunk(agent_id, filename, i, chunk_content, embedding)
        stored += 1

    logger.info(f"Ingestion complete for '{filename}': stored={stored}, failed={failed}")
    return {"filename": filename, "total_chunks": len(chunks), "stored": stored, "failed": failed}


# ─── Search at Chat Time ──────────────────────────────────────────────────────

async def search_chunks(agent_id: str, query: str, limit: int = 5) -> List[str]:
    """
    Embed the query and find the top-K most relevant chunks for this agent.
    Returns a list of chunk text strings (not the vectors).
    Returns empty list if embedding fails or agent has no chunks.
    """
    query_vector = await embed_query(query)
    if query_vector is None:
        logger.warning("Could not embed query — returning empty context")
        return []

    embedding_str = "[" + ",".join(str(v) for v in query_vector) + "]"

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT content
        FROM document_chunks
        WHERE agent_id = %s
        ORDER BY embedding <=> %s::vector
        LIMIT %s
    """, (agent_id, embedding_str, limit))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    return [row["content"] for row in rows]


# ─── Document Extraction ─────────────────────────────────────────────────────

def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract all text from a PDF file."""
    from pypdf import PdfReader
    import io
    reader = PdfReader(io.BytesIO(file_bytes))
    return "\n\n".join(
        page.extract_text() or "" for page in reader.pages
    ).strip()


def extract_text_from_docx(file_bytes: bytes) -> str:
    """Extract all text from a DOCX file."""
    from docx import Document
    import io
    doc = Document(io.BytesIO(file_bytes))
    return "\n\n".join(
        para.text for para in doc.paragraphs if para.text.strip()
    )


def extract_text_from_txt(file_bytes: bytes) -> str:
    """Decode a plain text file."""
    return file_bytes.decode("utf-8", errors="replace")


def extract_text(filename: str, file_bytes: bytes) -> str:
    """
    Route to the correct extractor based on file extension.
    Raises ValueError for unsupported types.
    """
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return extract_text_from_pdf(file_bytes)
    elif lower.endswith(".docx"):
        return extract_text_from_docx(file_bytes)
    elif lower.endswith(".txt") or lower.endswith(".md"):
        return extract_text_from_txt(file_bytes)
    else:
        raise ValueError(f"Unsupported file type: {filename}. Use PDF, DOCX, TXT, or MD.")
```

---

### 5.3 `webai-bridge/schemas/agents.py` — New schema file

```python
# schemas/agents.py
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class AgentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    instructions: str                          # behavioral rules — required
    model: str = "gemini-2.5-flash"

class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    model: Optional[str] = None
    is_active: Optional[bool] = None

class AgentResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    instructions: str                          # included for admin view
    model: str
    is_active: bool
    created_by: Optional[int]
    created_at: datetime
    updated_at: datetime

class AgentPublicResponse(BaseModel):
    """What the user (non-admin) sees — instructions are hidden."""
    id: str
    name: str
    description: Optional[str]
    model: str
```

---

### 5.4 `webai-bridge/schemas/documents.py` — New schema file

```python
# schemas/documents.py
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class DocumentUploadResponse(BaseModel):
    success: bool
    filename: str
    total_chunks: int
    stored: int
    failed: int
    message: str

class DocumentInfo(BaseModel):
    filename: str
    chunk_count: int
    created_at: datetime

class DocumentListResponse(BaseModel):
    success: bool
    agent_id: str
    documents: list
```

---

## 6. Files to Modify — Backend

### 6.1 `webai-bridge/auth.py` — Major changes

**What changes:**
- `create_token()` — add `role` to JWT payload
- `get_current_user()` — return `role` from DB
- NEW: `require_admin()` — FastAPI dependency for admin-only routes
- NEW: `validate_with_laravel()` — calls `POST /api/v1/auth/login`, parses Sanctum response

**What we know from reading the Laravel code:**
- Endpoint: `POST /api/v1/auth/login`
- Required header: `X-Correlation-Id: webai-bridge` (any 8–128 char string)
- Request body: `{ "email": "...", "password": "..." }`
- Success `200`: `{ "token": "42|...", "user": { "id": 42, "email": "...", "roles": [{"id":1,"name":"admin",...}] } }`
- Failure `422`: `{ "message": "...", "errors": { "email": ["These credentials do not match our records."] } }`
- Roles are **objects with a `name` field**, not plain strings
- Admin roles: `"admin"` and `"super-admin"` → both become Bridge role `"admin"`

**Full updated file:**

```python
# auth.py
import os
import httpx
import logging
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from database import get_connection

load_dotenv()
logger = logging.getLogger("auth")

SECRET_KEY        = os.getenv("SECRET_KEY", "change-me")
ALGORITHM         = "HS256"
TOKEN_EXPIRE_HOURS = 24 * 7   # 7 days

# Full URL: http://<laravel-host>/api/v1/auth/login
LARAVEL_AUTH_URL  = os.getenv("LARAVEL_AUTH_URL", "")

# Laravel role names that map to Bridge "admin"
ADMIN_ROLES = {"super-admin", "admin"}

pwd_context   = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


# ─── Password helpers (kept for backward compat / fallback) ─────────────────

def hash_password(plain: str) -> str:
    b = plain.encode("utf-8")
    if len(b) > 72:
        while len(b) > 0:
            try:
                plain = b[:72].decode("utf-8"); break
            except UnicodeDecodeError:
                b = b[:-1]
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    b = plain.encode("utf-8")
    if len(b) > 72:
        while len(b) > 0:
            try:
                plain = b[:72].decode("utf-8"); break
            except UnicodeDecodeError:
                b = b[:-1]
    return pwd_context.verify(plain, hashed)


# ─── Laravel auth validation ──────────────────────────────────────────────────

async def validate_with_laravel(email: str, password: str) -> Optional[dict]:
    """
    Call Laravel POST /api/v1/auth/login with email + password.
    Parses the Sanctum response and maps the role to Bridge format.

    Returns: { "user_id": int, "email": str, "role": "admin"|"user" }
    Returns None if credentials are wrong (422).
    Raises HTTPException(503) if Laravel is unreachable.
    """
    if not LARAVEL_AUTH_URL:
        logger.warning("LARAVEL_AUTH_URL not set — falling back to local validation")
        return None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                LARAVEL_AUTH_URL,
                json={"email": email, "password": password},
                headers={
                    # Required by Laravel's CorrelationIdMiddleware
                    "X-Correlation-Id": "webai-bridge",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                }
            )

        # 200 = valid credentials
        if resp.status_code == 200:
            data = resp.json()
            user = data.get("user", {})

            # Roles come as a list of objects: [{"id":1,"name":"admin","guard_name":"web"}]
            # Extract just the name strings
            laravel_roles = [r["name"] for r in user.get("roles", [])]

            # Map to Bridge role: "admin" or "user"
            bridge_role = "admin" if any(r in ADMIN_ROLES for r in laravel_roles) else "user"

            return {
                "user_id": user["id"],
                "email":   user["email"],
                "role":    bridge_role
            }

        # 422 = wrong credentials
        if resp.status_code == 422:
            logger.warning(f"Laravel rejected credentials for {email}")
            return None

        logger.error(f"Laravel auth returned unexpected status: {resp.status_code}")
        return None

    except httpx.ConnectError:
        logger.error(f"Cannot reach Laravel at {LARAVEL_AUTH_URL}")
        raise HTTPException(status_code=503, detail="Auth service unavailable")
    except Exception:
        logger.exception("Laravel auth validation failed")
        return None


# ─── JWT ──────────────────────────────────────────────────────────────────────

def create_token(user_id: int, email: str, role: str = "user") -> str:
    """Create a JWT. Now includes role so frontend can gate routes."""
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,                         # ← NEW
        "exp": datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if not payload.get("sub"):
            raise HTTPException(status_code=401, detail="Invalid token")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# ─── FastAPI dependencies ─────────────────────────────────────────────────────

def get_current_user(token: Optional[str] = Depends(oauth2_scheme)) -> dict:
    """Read and validate the JWT. Returns user dict with user_id, email, role."""
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_token(token)

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, email, role FROM users WHERE id = %s",
        (int(payload["sub"]),)
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if not row:
        raise HTTPException(status_code=401, detail="User not found")

    return {
        "user_id": row["id"],
        "email": row["email"],
        "role": row["role"]                   # ← NEW
    }


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """
    FastAPI dependency — use this instead of get_current_user for admin-only routes.
    Returns the user dict if they are admin, raises 403 otherwise.

    Usage in a route:
        @app.get("/admin/agents")
        def list_agents(user = Depends(require_admin)):
            ...
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
```

---

### 6.2 `webai-bridge/main.py` — Large additions

**What changes:**
- Import `require_admin` and `nats_sync`
- Update `/auth/login` to use Laravel validation
- Update `/auth/me` to include role
- Update `/api/chat` to accept `agent_id`, fetch instructions, run vector search, inject system prompt
- Update `POST /api/conversations` to accept `agent_id`
- Add all `/admin/*` endpoints
- Add `/api/agents` and `/api/agents/{id}` user endpoints
- Add `/health/nats` endpoint
- Start NATS sync on startup

**Changes section by section:**

#### A — New imports to add at the top of main.py

```python
from auth import hash_password, verify_password, create_token, get_current_user, require_admin, validate_with_laravel
from nats_sync import start_nats_sync, get_nats_status
from vector import ingest_document, search_chunks, extract_text
from schemas.agents import AgentCreate, AgentUpdate, AgentResponse, AgentPublicResponse
from schemas.documents import DocumentUploadResponse
from fastapi import UploadFile, File
import asyncio
import uuid
```

#### B — Update the Pydantic ChatMessage model

```python
class ChatMessage(BaseModel):
    message: str
    model: str = "gemini-2.5-flash"
    agent_id: Optional[str] = None    # ← NEW — if set, inject instructions + vector context
```

Also add `from typing import Optional` if not already imported.

#### C — Update startup event

```python
@app.on_event("startup")
async def startup():
    init_db()
    # Start NATS subscriber in background
    asyncio.create_task(start_nats_sync())
    logger.info("NATS sync task started")
```

> Change `def startup()` to `async def startup()` to allow `asyncio.create_task`.

#### D — Update `/auth/login` route

Replace the current login route with:

```python
@app.post("/auth/login")
async def login(data: LoginInput):
    """
    Login. Validates via Laravel auth API first.
    Falls back to local bcrypt validation if LARAVEL_AUTH_URL is not set.
    Returns JWT with role included.
    """
    from database import get_connection

    # Try Laravel first
    laravel_user = await validate_with_laravel(data.email, data.password)

    if laravel_user:
        # Find the user in our local DB (synced via NATS)
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, email, role FROM users WHERE external_id = %s",
            (laravel_user["user_id"],)
        )
        row = cursor.fetchone()
        cursor.close()
        conn.close()

        if not row:
            raise HTTPException(
                status_code=404,
                detail="User not found in local database — NATS sync may be delayed. Try again in a moment."
            )

        token = create_token(row["id"], row["email"], row["role"])
        return {"success": True, "token": token, "email": row["email"], "role": row["role"]}

    # Fallback: local bcrypt validation (for users created before NATS sync)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, email, password_hash, role FROM users WHERE email = %s",
        (data.email.lower().strip(),)
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if not row or row["password_hash"] == "EXTERNAL_AUTH":
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(data.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_token(row["id"], row["email"], row["role"])
    return {"success": True, "token": token, "email": row["email"], "role": row["role"]}
```

#### E — Update `/auth/me` to include role

```python
@app.get("/auth/me", dependencies=[Depends(get_current_user)])
def me(user = Depends(get_current_user)):
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "role": user["role"]          # ← NEW
    }
```

#### F — Update `/api/chat` to support agent injection

Replace the existing chat route:

```python
class ChatMessage(BaseModel):
    message: str
    model: str = "gemini-2.5-flash"
    agent_id: Optional[str] = None

@app.post("/api/chat", dependencies=[Depends(get_current_user)])
async def chat(data: ChatMessage, user = Depends(get_current_user)):
    """
    Stream chat. If agent_id is provided:
      1. Verify user is assigned to that agent
      2. Fetch agent instructions
      3. Run vector search for relevant context chunks
      4. Inject system prompt (instructions + context) before forwarding
    """
    user_id = str(user["user_id"])
    model = data.model
    messages = [{"role": "user", "content": data.message}]

    # ─── Agent injection ────────────────────────────────────────────
    if data.agent_id:
        conn = get_connection()
        cursor = conn.cursor()

        # Check user is assigned to this agent
        cursor.execute("""
            SELECT a.instructions, a.model
            FROM agents a
            JOIN user_agents ua ON ua.agent_id = a.id
            WHERE a.id = %s AND ua.user_id = %s AND a.is_active = true
        """, (data.agent_id, user["user_id"]))
        agent_row = cursor.fetchone()
        cursor.close()
        conn.close()

        if not agent_row:
            raise HTTPException(status_code=403, detail="Agent not assigned to you or does not exist")

        # Use the agent's model
        model = agent_row["model"]

        # Vector search — get top 5 relevant chunks
        relevant_chunks = await search_chunks(data.agent_id, data.message, limit=5)

        # Build system prompt
        system_parts = [agent_row["instructions"]]
        if relevant_chunks:
            system_parts.append("\n\n--- Relevant Knowledge ---")
            for i, chunk in enumerate(relevant_chunks, 1):
                system_parts.append(f"[{i}] {chunk}")

        system_prompt = "\n".join(system_parts)
        messages = [{"role": "system", "content": system_prompt}] + messages
    # ────────────────────────────────────────────────────────────────

    request_body = {"model": model, "stream": True, "messages": messages}

    async def stream_from_webai():
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{WEBAI_URL}/v1/chat/completions",
                    json=request_body,
                    headers={
                        "Content-Type": "application/json",
                        "X-Internal-Key": WEBAI_INTERNAL_KEY,
                        "X-Internal-User-ID": user_id,
                    }
                ) as response:
                    if response.status_code != 200:
                        error = await response.aread()
                        yield f"data: {json.dumps({'error': error.decode()})}\n\n"
                        return
                    async for line in response.aiter_lines():
                        if line:
                            yield f"{line}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        stream_from_webai(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}
    )
```

#### G — Add `/health/nats` endpoint

```python
@app.get("/health/nats")
def health_nats():
    connected = get_nats_status()
    return {
        "nats_connected": connected,
        "status": "ok" if connected else "degraded",
        "message": "NATS connected" if connected else "NATS disconnected — user sync paused"
    }
```

#### H — Add all `/admin/*` endpoints

Add this entire block to main.py:

```python
# ════════════════════════════════════════════════════════
# ADMIN — AGENT CRUD
# All require require_admin dependency
# ════════════════════════════════════════════════════════

@app.get("/admin/agents")
def admin_list_agents(user = Depends(require_admin)):
    """List all agents (active and inactive)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, name, description, instructions, model, is_active, created_by, created_at, updated_at
        FROM agents ORDER BY created_at DESC
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return {"success": True, "agents": [dict(r) for r in rows]}


@app.post("/admin/agents")
def admin_create_agent(data: AgentCreate, user = Depends(require_admin)):
    """Create a new agent."""
    conn = get_connection()
    cursor = conn.cursor()
    agent_id = str(uuid.uuid4())
    cursor.execute("""
        INSERT INTO agents (id, name, description, instructions, model, created_by)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id, name, description, instructions, model, is_active, created_by, created_at, updated_at
    """, (agent_id, data.name, data.description, data.instructions, data.model, user["user_id"]))
    row = cursor.fetchone()
    conn.commit()
    cursor.close()
    conn.close()
    return {"success": True, "agent": dict(row)}


@app.get("/admin/agents/{agent_id}")
def admin_get_agent(agent_id: str, user = Depends(require_admin)):
    """Get a single agent with full details including instructions."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM agents WHERE id = %s", (agent_id,))
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"success": True, "agent": dict(row)}


@app.put("/admin/agents/{agent_id}")
def admin_update_agent(agent_id: str, data: AgentUpdate, user = Depends(require_admin)):
    """Update any field of an agent."""
    updates, params = [], []
    if data.name is not None:         updates.append("name = %s");         params.append(data.name)
    if data.description is not None:  updates.append("description = %s");  params.append(data.description)
    if data.instructions is not None: updates.append("instructions = %s"); params.append(data.instructions)
    if data.model is not None:        updates.append("model = %s");        params.append(data.model)
    if data.is_active is not None:    updates.append("is_active = %s");    params.append(data.is_active)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates.append("updated_at = NOW()")
    params.append(agent_id)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        f"UPDATE agents SET {', '.join(updates)} WHERE id = %s RETURNING *",
        params
    )
    row = cursor.fetchone()
    conn.commit()
    cursor.close()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"success": True, "agent": dict(row)}


@app.delete("/admin/agents/{agent_id}")
def admin_delete_agent(agent_id: str, user = Depends(require_admin)):
    """Soft-delete: set is_active = false. Does NOT remove data or chunks."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE agents SET is_active = false, updated_at = NOW() WHERE id = %s",
        (agent_id,)
    )
    found = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    if not found:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"success": True, "message": "Agent deactivated"}


# ════════════════════════════════════════════════════════
# ADMIN — DOCUMENT UPLOAD (vector ingestion)
# ════════════════════════════════════════════════════════

@app.post("/admin/agents/{agent_id}/documents")
async def admin_upload_document(
    agent_id: str,
    file: UploadFile = File(...),
    user = Depends(require_admin)
):
    """
    Upload a document for an agent.
    Extracts text → chunks → embeds → stores in document_chunks.
    Supported: PDF, DOCX, TXT, MD
    """
    # Verify agent exists
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM agents WHERE id = %s", (agent_id,))
    if not cursor.fetchone():
        cursor.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Agent not found")
    cursor.close()
    conn.close()

    file_bytes = await file.read()
    try:
        text = extract_text(file.filename, file_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not text.strip():
        raise HTTPException(status_code=400, detail="Document appears to be empty or unreadable")

    result = await ingest_document(agent_id, file.filename, text)
    return {
        "success": True,
        **result,
        "message": f"Uploaded and indexed {result['stored']} chunks from '{file.filename}'"
    }


@app.get("/admin/agents/{agent_id}/documents")
def admin_list_documents(agent_id: str, user = Depends(require_admin)):
    """List all documents (grouped by filename) for an agent."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT filename, COUNT(*) as chunk_count, MIN(created_at) as created_at
        FROM document_chunks
        WHERE agent_id = %s
        GROUP BY filename
        ORDER BY created_at DESC
    """, (agent_id,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return {"success": True, "agent_id": agent_id, "documents": [dict(r) for r in rows]}


@app.delete("/admin/agents/{agent_id}/documents/{filename}")
def admin_delete_document(agent_id: str, filename: str, user = Depends(require_admin)):
    """Delete all chunks for a specific filename from an agent."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "DELETE FROM document_chunks WHERE agent_id = %s AND filename = %s",
        (agent_id, filename)
    )
    deleted = cursor.rowcount
    conn.commit()
    cursor.close()
    conn.close()
    return {"success": True, "deleted_chunks": deleted, "message": f"Removed '{filename}'"}


# ════════════════════════════════════════════════════════
# ADMIN — USER-AGENT ASSIGNMENT
# ════════════════════════════════════════════════════════

@app.get("/admin/agents/{agent_id}/users")
def admin_get_agent_users(agent_id: str, user = Depends(require_admin)):
    """List all users assigned to an agent."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT u.id, u.email, u.role, ua.assigned_at
        FROM users u
        JOIN user_agents ua ON ua.user_id = u.id
        WHERE ua.agent_id = %s
        ORDER BY ua.assigned_at DESC
    """, (agent_id,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return {"success": True, "users": [dict(r) for r in rows]}


class AssignUsersInput(BaseModel):
    user_ids: list   # list of integer user IDs

@app.post("/admin/agents/{agent_id}/users")
def admin_assign_users(agent_id: str, data: AssignUsersInput, user = Depends(require_admin)):
    """Assign one or more users to an agent. Skips duplicates."""
    conn = get_connection()
    cursor = conn.cursor()
    assigned = 0
    for uid in data.user_ids:
        try:
            cursor.execute("""
                INSERT INTO user_agents (user_id, agent_id)
                VALUES (%s, %s)
                ON CONFLICT (user_id, agent_id) DO NOTHING
            """, (uid, agent_id))
            assigned += cursor.rowcount
        except Exception:
            pass
    conn.commit()
    cursor.close()
    conn.close()
    return {"success": True, "assigned": assigned, "message": f"Assigned {assigned} user(s)"}


@app.delete("/admin/agents/{agent_id}/users/{target_user_id}")
def admin_remove_user_from_agent(agent_id: str, target_user_id: int, user = Depends(require_admin)):
    """Remove a user's assignment from an agent."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "DELETE FROM user_agents WHERE agent_id = %s AND user_id = %s",
        (agent_id, target_user_id)
    )
    found = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    if not found:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return {"success": True, "message": "User removed from agent"}


# ════════════════════════════════════════════════════════
# ADMIN — USER MANAGEMENT
# ════════════════════════════════════════════════════════

@app.get("/admin/users")
def admin_list_users(user = Depends(require_admin)):
    """List all users (synced from NATS/Laravel)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, email, role, external_id, synced_at, created_at
        FROM users ORDER BY created_at DESC
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return {"success": True, "users": [dict(r) for r in rows]}


class RoleUpdate(BaseModel):
    role: str   # "admin" or "user"

@app.put("/admin/users/{target_user_id}/role")
def admin_update_user_role(target_user_id: int, data: RoleUpdate, user = Depends(require_admin)):
    """Change a user's role. Allowed values: 'admin', 'user'."""
    if data.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE users SET role = %s WHERE id = %s",
        (data.role, target_user_id)
    )
    found = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    if not found:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "message": f"Role updated to '{data.role}'"}


# ════════════════════════════════════════════════════════
# USER — AGENT DISCOVERY
# ════════════════════════════════════════════════════════

@app.get("/api/agents")
def user_list_my_agents(user = Depends(get_current_user)):
    """List agents assigned to the logged-in user. Instructions are hidden."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT a.id, a.name, a.description, a.model
        FROM agents a
        JOIN user_agents ua ON ua.agent_id = a.id
        WHERE ua.user_id = %s AND a.is_active = true
        ORDER BY a.name ASC
    """, (user["user_id"],))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return {"success": True, "agents": [dict(r) for r in rows]}


@app.get("/api/agents/{agent_id}")
def user_get_agent(agent_id: str, user = Depends(get_current_user)):
    """Get details of an agent assigned to this user. Instructions are hidden."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT a.id, a.name, a.description, a.model
        FROM agents a
        JOIN user_agents ua ON ua.agent_id = a.id
        WHERE a.id = %s AND ua.user_id = %s AND a.is_active = true
    """, (agent_id, user["user_id"]))
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found or not assigned to you")
    return {"success": True, "agent": dict(row)}
```

---

### 6.3 `webai-bridge/schemas/users.py` — Add role and external_id

```python
# schemas/users.py
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class UserPreferencesUpdate(BaseModel):
    default_model: Optional[str] = None
    theme: Optional[str] = None

class UserProfileResponse(BaseModel):
    success: bool
    user: dict
    user_id: int
    email: str
    role: str                              # ← NEW
    created_at: datetime
    last_login: Optional[datetime] = None
    preferences: dict
```

---

### 6.4 `webai-bridge/schemas/conversations.py` — Add agent_id

```python
# schemas/conversations.py
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List

class ConversationCreate(BaseModel):
    title: Optional[str] = "New Conversation"
    model: str = "gemini-2.5-flash"
    agent_id: Optional[str] = None        # ← NEW

class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    model: Optional[str] = None

class ConversationResponse(BaseModel):
    id: str
    user_id: int
    title: str
    model: str
    agent_id: Optional[str] = None        # ← NEW
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
```

---

## 7. Files to Modify — Frontend

The frontend is React + TypeScript + Tailwind. Below is a list of every file that changes and exactly what to do in each.

### 7.1 Auth Context / Token Handling

**Where:** wherever the JWT token is decoded/stored after login (likely `src/context/AuthContext.tsx` or similar)

**What to add:**
- Decode the JWT payload on login and store `role` in context state
- Expose `role` and `isAdmin` from the context
- Update the login function to read `role` from the `/auth/login` response (the API now returns `role` in the response body — no need to decode JWT manually)

```typescript
// What the login response now looks like:
// { success: true, token: "...", email: "...", role: "admin" }

// Store this in context:
interface AuthState {
  token: string | null
  email: string | null
  role: 'admin' | 'user' | null
  isAdmin: boolean
}
```

---

### 7.2 `src/app/AppShell.tsx` — Show Admin nav link

**What to change:**
- Import the auth context to read `isAdmin`
- Conditionally render an "Admin" link in the sidebar nav

```typescript
// Add this to your sidebar nav items:
{isAdmin && (
  <NavLink to="/admin">
    Admin Panel
  </NavLink>
)}
```

---

### 7.3 Router — Add `/admin/*` route tree with role guard

**Where:** `src/App.tsx` or wherever React Router routes are defined

**What to add:**

```typescript
// Create a ProtectedAdminRoute component:
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

// Add these routes:
<Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
<Route path="/admin/agents" element={<AdminRoute><AgentList /></AdminRoute>} />
<Route path="/admin/agents/new" element={<AdminRoute><CreateAgent /></AdminRoute>} />
<Route path="/admin/agents/:id/edit" element={<AdminRoute><EditAgent /></AdminRoute>} />
<Route path="/admin/agents/:id/documents" element={<AdminRoute><AgentDocuments /></AdminRoute>} />
<Route path="/admin/agents/:id/assign" element={<AdminRoute><AssignUsers /></AdminRoute>} />
<Route path="/admin/users" element={<AdminRoute><UserList /></AdminRoute>} />
```

---

### 7.4 Chat Page — Agent selector

**What to change:**
- On chat page load: call `GET /api/agents` to get the user's assigned agents
- Show a dropdown to pick an agent (or "No agent" if allowed)
- When agent is selected, auto-set the model from `agent.model`
- Pass `agent_id` in the chat request body

```typescript
// When sending a message, include agent_id:
const body = {
  message: userInput,
  model: selectedModel,
  agent_id: selectedAgent?.id ?? null   // null if no agent selected
}
```

---

### 7.5 Conversation list — Show agent name

**What to change:**
- `GET /api/conversations` now returns `agent_id` on each conversation
- Load the user's agents once and map `agent_id → agent.name`
- Show the agent name as a small badge or subtitle under each conversation title

---

### 7.6 New Admin Pages to Create

Create a folder: `src/pages/admin/`

| File | API calls it makes | Key UI elements |
|------|--------------------|-----------------|
| `AdminDashboard.tsx` | `GET /admin/agents` count, `GET /admin/users` count, `GET /health/nats` | Stat cards, NATS status badge |
| `AgentList.tsx` | `GET /admin/agents`, `DELETE /admin/agents/{id}` | Table with name, model, status badge, Edit/Docs/Assign/Delete buttons |
| `CreateAgent.tsx` | `POST /admin/agents` | Form: name, description, model selector, instructions textarea |
| `EditAgent.tsx` | `GET /admin/agents/{id}`, `PUT /admin/agents/{id}` | Same form pre-filled |
| `AgentDocuments.tsx` | `GET /admin/agents/{id}/documents`, `POST /admin/agents/{id}/documents`, `DELETE /admin/agents/{id}/documents/{filename}` | File upload area, documents list, delete per doc |
| `AssignUsers.tsx` | `GET /admin/users`, `GET /admin/agents/{id}/users`, `POST /admin/agents/{id}/users`, `DELETE /admin/agents/{id}/users/{uid}` | Two-column: all users left, assigned users right. Click to move |
| `UserList.tsx` | `GET /admin/users`, `PUT /admin/users/{id}/role` | Table with email, role badge, Change Role button |

---

## 8. Docker Compose Changes

**File to change:** `docker-compose.yml`

### 8.1 Add NATS service

```yaml
  # NATS Message Broker
  nats:
    image: nats:2.10-alpine
    container_name: webai-nats
    ports:
      - "4222:4222"    # client connections
      - "8222:8222"    # HTTP monitoring
    command: ["--jetstream", "--http_port", "8222"]
    restart: unless-stopped
    networks:
      - webai_network
```

### 8.2 Update bridge service — add new env vars and NATS dependency

```yaml
  bridge:
    build:
      context: ./webai-bridge
      dockerfile: Dockerfile
    container_name: webai-bridge
    environment:
      DATABASE_URL: postgresql://${DB_USER:-webai_user}:${DB_PASSWORD:-change_me_please}@db:5432/webai_bridge
      WEBAI_URL: http://webai:6969
      WEBAI_INTERNAL_KEY: ${WEBAI_INTERNAL_KEY}
      SECRET_KEY: ${SECRET_KEY}
      COOKIE_ENCRYPTION_KEY: ${COOKIE_ENCRYPTION_KEY}
      # ── NEW ──────────────────────────────────────────
      NATS_URL: nats://nats:4222
      LARAVEL_AUTH_URL: ${LARAVEL_AUTH_URL}
      GEMINI_API_KEY: ${GEMINI_API_KEY}
    depends_on:
      db:
        condition: service_healthy
      webai:
        condition: service_healthy
      nats:                               # ← NEW dependency
        condition: service_started
    # rest stays the same
```

### 8.3 Update PostgreSQL to use pgvector image

```yaml
  db:
    image: pgvector/pgvector:pg16    # ← CHANGE from postgres:16-alpine
    # everything else stays the same
```

> **Why:** The standard `postgres:16-alpine` image does not include the `vector` extension. `pgvector/pgvector:pg16` is the official pgvector image with PostgreSQL 16. It is a drop-in replacement — same config, same volumes work.

---

## 9. Environment Variables

### Variables to add to `.env` (next to docker-compose.yml)

```env
# Existing variables (keep as-is)
DB_USER=webai_user
DB_PASSWORD=your_secure_password
WEBAI_INTERNAL_KEY=your_internal_key
SECRET_KEY=your_jwt_secret
COOKIE_ENCRYPTION_KEY=your_encryption_key

# ── NEW variables ─────────────────────────────────────────────────────────────

# Laravel login endpoint — full path including /api/v1/auth/login
# Local XAMPP: http://localhost/projacet/pizzasys/public/api/v1/auth/login
# Or if using php artisan serve: http://127.0.0.1:8000/api/v1/auth/login
# Production: https://your-domain.com/api/v1/auth/login
LARAVEL_AUTH_URL=http://localhost/projacet/pizzasys/public/api/v1/auth/login

# Service Client credentials — get from Laravel team
# They create it in their system and give you the plain token
LARAVEL_SERVICE_NAME=webai-bridge
LARAVEL_SERVICE_TOKEN=

# NATS connection
# Use docker service name in compose: nats://nats:4222
# Local (if Laravel NATS runs on host): nats://host.docker.internal:4222
NATS_URL=nats://nats:4222

# NATS token auth — must match Laravel's NATS_TOKEN in their .env
# Leave empty if NATS has no auth configured
NATS_TOKEN=

# Gemini API key — for document embeddings and query embeddings
# Get from: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=AIza...your_key_here
```

### Variables to add to frontend `.env`

```env
# Existing
VITE_API_URL=http://localhost:8000

# No new frontend env vars needed — role comes from the API response
```

---

## 10. New API Endpoints Reference

A quick-reference for all endpoints added by this feature (for the frontend team):

### Admin endpoints — require `role: admin` in JWT

| Method | Endpoint | Body / Params | Returns |
|--------|----------|---------------|---------|
| GET | `/admin/agents` | — | `{ agents: [...] }` |
| POST | `/admin/agents` | `{ name, description, instructions, model }` | `{ agent }` |
| GET | `/admin/agents/:id` | — | `{ agent }` with instructions |
| PUT | `/admin/agents/:id` | any of: `name, description, instructions, model, is_active` | `{ agent }` |
| DELETE | `/admin/agents/:id` | — | `{ success }` — soft delete |
| POST | `/admin/agents/:id/documents` | `multipart/form-data` file | `{ stored, total_chunks, failed }` |
| GET | `/admin/agents/:id/documents` | — | `{ documents: [{filename, chunk_count}] }` |
| DELETE | `/admin/agents/:id/documents/:filename` | — | `{ deleted_chunks }` |
| GET | `/admin/agents/:id/users` | — | `{ users: [{id, email, role}] }` |
| POST | `/admin/agents/:id/users` | `{ user_ids: [1, 2, 3] }` | `{ assigned }` |
| DELETE | `/admin/agents/:id/users/:user_id` | — | `{ success }` |
| GET | `/admin/users` | — | `{ users: [{id, email, role, external_id}] }` |
| PUT | `/admin/users/:id/role` | `{ role: "admin" or "user" }` | `{ success }` |

### User endpoints

| Method | Endpoint | Returns |
|--------|----------|---------|
| GET | `/api/agents` | `{ agents: [{id, name, description, model}] }` — only assigned ones, no instructions |
| GET | `/api/agents/:id` | `{ agent }` — only if assigned to this user |

### Updated existing endpoints

| Endpoint | What changed |
|----------|-------------|
| `POST /auth/login` | Response now includes `role` field |
| `GET /auth/me` | Response now includes `role` field |
| `POST /api/chat` | Body now accepts optional `agent_id` |
| `POST /api/conversations` | Body now accepts optional `agent_id` |
| `GET /health/nats` | New — returns NATS connection status |

---

## 11. The Full Chat Flow After Changes

```
User opens chat → selects agent from dropdown (GET /api/agents)
     ↓
User types message → sends POST /api/chat { message, agent_id }
     ↓
Bridge receives request
  1. Verify JWT → get user_id + role
  2. Check user_agents table: is this user assigned to this agent? → 403 if not
  3. Fetch agent.instructions and agent.model from agents table
  4. Embed user message → call Gemini Embeddings API → 768-dim vector
  5. Run pgvector query: SELECT TOP 5 chunks WHERE agent_id = ? ORDER BY cosine similarity
  6. Build system prompt:
       [agent.instructions]
       --- Relevant Knowledge ---
       [chunk 1]
       [chunk 2]
       ...
  7. Prepend system message to messages array
  8. Forward to WebAI (port 6969) with X-Internal-User-ID header
     ↓
WebAI forwards to Gemini with enriched messages
     ↓
Gemini streams response back → WebAI → Bridge → Frontend (SSE)
     ↓
Bridge saves user message + full AI response to conversation_messages table
```

---

## 12. What Does NOT Change

| Service / File | Why untouched |
|----------------|--------------|
| `WebAI-to-API` (port 6969) | Dataset injection happens in Bridge before forwarding. WebAI just executes Gemini — no new logic needed there |
| `webai-bridge/services/cookie_service.py` | Gemini cookie storage unchanged |
| `webai-bridge/services/conversation_service.py` | Only needs `agent_id` passed in from main.py — the service itself is fine |
| `webai-bridge/services/message_service.py` | No changes needed |
| Frontend Gemini cookie connection flow | Unchanged — users still connect their own Gemini accounts for chat |
| Docker volumes | `postgres_data` volume is preserved — data migrates safely in-place |

---

*Work through this document top-to-bottom. Each step depends on the previous one. The largest risks are Step 1 (confirming open questions with the Laravel team) and Step 5 (getting a valid GEMINI_API_KEY for embeddings) — unblock those first.*

---

## 13. Open Questions — Must Answer Before Starting

> These are the only remaining unknowns after reading the Laravel source code.
> Get answers from the Laravel team, fill them in here, then implementation can start.

---

### Q1 — What is the exact base URL of the Laravel app?

We read the project at `C:\xampp\htdocs\projacet\pizzasys`.
Depending on how XAMPP is configured, the URL could be one of:

| Scenario | URL |
|----------|-----|
| XAMPP default | `http://localhost/projacet/pizzasys/public` |
| Virtual host configured | `http://pizzasys.local` |
| `php artisan serve` | `http://127.0.0.1:8000` |
| Production server | `https://your-domain.com` |

**Full login URL the Bridge will call:**
`<base_url>/api/v1/auth/login`

**→ What is the correct base URL?**

---

### Q2 — What exact role names are used in this system?

From the code we know the system uses Spatie roles and there is a `super-admin` bypass.
But we do not know what roles are actually seeded in the database.

We mapped these two to Bridge `"admin"`:
```python
ADMIN_ROLES = {"super-admin", "admin"}
```

**→ Run this in Laravel tinker and share the output:**
```bash
php artisan tinker
>>> \Spatie\Permission\Models\Role::pluck('name')
```

If there are roles like `"manager"` or `"owner"` that should also be treated as admin in the Bridge, we need to add them to `ADMIN_ROLES`.

---

### Q3 — Does the NATS server require authentication?

From `config/nats.php` in Laravel, NATS can be configured with:
- `NATS_TOKEN` — a single token
- `NATS_USER` + `NATS_PASS` — username/password

**→ Check Laravel's `.env` file: is `NATS_TOKEN` or `NATS_USER`/`NATS_PASS` set?**

If yes, the same value goes into the Bridge's `NATS_TOKEN` env var.
If no (no auth), leave `NATS_TOKEN` empty in Bridge `.env`.

---

### Q4 — Is NATS already running, or do we need to start it ourselves?

Two scenarios:

**a) Laravel is already publishing events to a running NATS server**
→ Bridge just connects to that same server. Do NOT add the NATS service to `docker-compose.yml` — connect to the existing one instead.

**b) NATS is not running yet**
→ We add the NATS service to `docker-compose.yml` as planned, AND the Laravel team must also point their NATS config to this same server.

**→ Is NATS already running somewhere? If yes, what is its host:port?**

---

### Q5 — Has a ServiceClient been created for the Bridge?

The Bridge needs a registered ServiceClient in Laravel to call the `token-verify` endpoint.
This is a row in the `service_clients` table with `name = "webai-bridge"`.

**→ Please run this in Laravel tinker and share the generated token (shown once):**
```php
php artisan tinker

$token = base64_encode(random_bytes(48));

\App\Models\ServiceClient::create([
    'name'       => 'webai-bridge',
    'token_hash' => hash('sha256', $token),
    'is_active'  => true,
    'notes'      => 'WebAI Bridge service',
]);

echo $token;   // ← copy this value into Bridge .env as LARAVEL_SERVICE_TOKEN
```

> Note: The Bridge only needs this for the `token-verify` endpoint. For basic login validation it is NOT required. This can be done later.

---

### Q6 — Confirm the exact NATS event `data` field names

From reading the Laravel source code, we expect this shape for `auth.v1.user.created`:

```json
{
  "data": {
    "user_id": 42,
    "name": "Alice",
    "email": "alice@example.com",
    "roles": ["admin"]
  }
}
```

**→ Can the Laravel team share one real example event from their logs or confirm the field names?**

Specifically confirm:
- Is the user ID field called `user_id` or `id`?
- Is the roles field called `roles` and is it an array of strings or array of objects?

---

### Q7 — What document types should agents support?

The vector pipeline in `vector.py` currently supports: **PDF, DOCX, TXT, MD**

**→ Is this enough, or do you also need:**
- Excel / CSV files?
- Web URLs (scrape a webpage and chunk it)?
- Images with text (OCR)?

Adding new types later is easy — this just affects what file formats the admin upload UI accepts.

---

### Q8 — Can a user chat without an assigned agent?

Currently the chat endpoint allows `agent_id: null` — if no agent is selected, the message goes straight to Gemini with no system prompt.

**→ Should users be blocked from chatting if they have no assigned agent?**

- **Yes, block them** → add a check: if no agents assigned, return 403 with "Contact admin to assign an agent"
- **No, allow free chat** → keep current behavior (agent_id is optional)

---

### Q9 — Who connects the Gemini account used for embeddings?

The vector pipeline calls the Gemini Embeddings API using `GEMINI_API_KEY`.
This is a Google AI Studio API key, not a browser cookie.

**→ Who provides this key?**
- The admin gets it from [aistudio.google.com](https://aistudio.google.com/app/apikey) and puts it in the Bridge `.env`
- OR it comes from a shared company account

This key is needed **before document upload can work**. Without it, `vector.py` cannot generate embeddings and ingestion will fail.
