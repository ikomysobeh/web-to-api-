# pgvector + Ollama Setup Guide
## Step-by-Step: Switch from Gemini API to Free Local Embeddings

---

## Before You Start — What This Guide Does

Right now our project uses **Gemini API** to generate embeddings (paid, cloud).
This guide replaces that with **Ollama** (free, local, runs on your machine).

The database and search code do NOT change — only the part that calls the embedding API.

**Time to complete: about 1 hour**

---

## What You Need

- Docker running (already have this ✅)
- The project at `C:\New folder` (already have this ✅)
- At least 3GB of free disk space (for the Ollama model)
- At least 2GB of free RAM available when running

---

## STEP 1 — Install Ollama on Windows

Go to this address in your browser:
```
https://ollama.com/download
```

Click **"Download for Windows"** and run the installer.

When the install finishes, open a new terminal and test:
```
ollama --version
```

You should see something like: `ollama version 0.5.x`

**Tell me what version you see ✅**
If you see an error → tell me ❌

---

## STEP 2 — Download the Embedding Model

In the terminal, run:
```
ollama pull nomic-embed-text
```

This downloads a 274MB model. It will take a few minutes depending on your internet.

Wait until you see:
```
success
```

To verify it downloaded:
```
ollama list
```

You should see `nomic-embed-text` in the list.

**Tell me when done ✅**

---

## STEP 3 — Test That Ollama Works

Run this command to test the embedding:

```
curl http://localhost:11434/api/embeddings -d "{\"model\": \"nomic-embed-text\", \"prompt\": \"hello world\"}"
```

You should see a long response that starts like:
```json
{"embedding":[-0.123, 0.456, -0.789, ...]}
```

If you see a response with numbers → Ollama is working ✅

If you see "connection refused" → Ollama is not running. Start it:
```
ollama serve
```
Then try the curl command again.

**Tell me what you see ✅**

---

## STEP 4 — Update the Python Code

We need to change 2 functions in `vector.py`.

Open this file:
```
C:\New folder\webai-bridge\vector.py
```

**Replace the entire file content** with the version below.

The changes are only in `embed_text()` and `embed_query()` — everything else is identical.

```python
# vector.py
import httpx
import logging
import os
import re
import uuid
from typing import List, Optional
from database import get_connection

logger = logging.getLogger("vector")

# ─── Config ─────────────────────────────────────────────────────────────────
# Ollama runs locally — no API key needed
OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "nomic-embed-text")
EMBED_DIMENSIONS = 768   # nomic-embed-text produces 768 dims — matches DB column

CHUNK_SIZE = 1500
CHUNK_OVERLAP = 150


# ─── Text Chunking ───────────────────────────────────────────────────────────

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    text = text.strip()
    if not text:
        return []
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks = []
    current = ""
    for sentence in sentences:
        if len(current) + len(sentence) + 1 <= chunk_size:
            current = current + " " + sentence if current else sentence
        else:
            if current:
                chunks.append(current.strip())
            if len(sentence) > chunk_size:
                for i in range(0, len(sentence), chunk_size - overlap):
                    chunks.append(sentence[i:i + chunk_size])
                current = ""
            else:
                current = sentence
    if current:
        chunks.append(current.strip())
    return [c for c in chunks if c]


# ─── Embedding via Ollama ────────────────────────────────────────────────────

async def embed_text(text: str) -> Optional[List[float]]:
    """Call Ollama and return a 768-dimension vector. Returns None if call fails."""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": OLLAMA_MODEL, "prompt": text}
            )
            resp.raise_for_status()
            return resp.json()["embedding"]
    except Exception:
        logger.exception(f"Ollama embed_text failed for: {text[:80]}...")
        return None


async def embed_query(text: str) -> Optional[List[float]]:
    """Same as embed_text — Ollama uses the same endpoint for queries."""
    return await embed_text(text)


# ─── Storage ─────────────────────────────────────────────────────────────────

def store_chunk(agent_id: str, filename: str, chunk_index: int, content: str, embedding: List[float]) -> str:
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
    from pypdf import PdfReader
    import io
    reader = PdfReader(io.BytesIO(file_bytes))
    return "\n\n".join(page.extract_text() or "" for page in reader.pages).strip()


def extract_text_from_docx(file_bytes: bytes) -> str:
    from docx import Document
    import io
    doc = Document(io.BytesIO(file_bytes))
    return "\n\n".join(para.text for para in doc.paragraphs if para.text.strip())


def extract_text_from_txt(file_bytes: bytes) -> str:
    return file_bytes.decode("utf-8", errors="replace")


def extract_text(filename: str, file_bytes: bytes) -> str:
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

**Tell me when you have saved the file ✅**

---

## STEP 5 — Add Ollama Package to requirements.txt

Open this file:
```
C:\New folder\webai-bridge\requirements.txt
```

Find this line:
```
# NATS messaging client
```

Add `ollama==0.4.8` just before it:
```
# Ollama local embedding client
ollama==0.4.8
# NATS messaging client
```

Save the file.

**Tell me when done ✅**

---

## STEP 6 — Update the Environment File

Open this file:
```
C:\New folder\webai-bridge\.env
```

Find these lines:
```
# Gemini API key - for document and query embeddings
# Get from: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=...
```

Replace them with:
```
# Ollama local embedding server
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=nomic-embed-text
```

Also open the root file:
```
C:\New folder\.env
```

Find and remove (or comment out) the GEMINI_API_KEY line:
```
# GEMINI_API_KEY=...  (commented out — using Ollama now)
```

**Tell me when done ✅**

---

## STEP 7 — Update docker-compose.yml (Pass Ollama URL to Bridge)

The bridge container runs inside Docker. It needs to reach Ollama which runs outside Docker on your Windows machine.

Inside Docker, your Windows host machine is at IP `host-gateway`. We need to tell the bridge where to find Ollama.

Open:
```
C:\New folder\docker-compose.yml
```

In the `bridge` service `environment` section, find:
```yaml
      GEMINI_API_KEY: ${GEMINI_API_KEY:-}
```

Replace it with:
```yaml
      OLLAMA_URL: http://host-gateway:11434
      OLLAMA_MODEL: nomic-embed-text
```

Also add `host-gateway` to the bridge's network config. Find the bridge service and add:
```yaml
    extra_hosts:
      - "host-gateway:host-gateway"
```

The bridge service should look like this after the change:

```yaml
  bridge:
    build:
      context: ./webai-bridge
      dockerfile: Dockerfile
    container_name: webai-bridge
    extra_hosts:
      - "host-gateway:host-gateway"
    environment:
      DATABASE_URL: postgresql://${DB_USER:-webai_user}:${DB_PASSWORD:-change_me_please}@db:5432/webai_bridge
      WEBAI_URL: http://webai:6969
      WEBAI_INTERNAL_KEY: ${WEBAI_INTERNAL_KEY}
      SECRET_KEY: ${SECRET_KEY}
      COOKIE_ENCRYPTION_KEY: ${COOKIE_ENCRYPTION_KEY}
      NATS_URL: nats://nats:4222
      NATS_TOKEN: ${NATS_TOKEN:-}
      NATS_USER: ${NATS_USER:-}
      NATS_PASS: ${NATS_PASS:-}
      NATS_AUTH_STREAM: ${NATS_AUTH_STREAM:-AUTH_EVENTS}
      NATS_AUTH_DURABLE: ${NATS_AUTH_DURABLE:-WEBAI_BRIDGE_AUTH_CONSUMER}
      DEV_MODE: ${DEV_MODE:-0}
      LARAVEL_AUTH_URL: ${LARAVEL_AUTH_URL:-}
      OLLAMA_URL: http://host-gateway:11434
      OLLAMA_MODEL: nomic-embed-text
    ports:
      - "8000:8000"
    ...
```

**Tell me when done ✅**

---

## STEP 8 — Rebuild and Restart Docker

In `C:\New folder`, run:

```
docker compose up --build
```

Wait until you see:
```
webai-bridge  | NATS connected
webai-bridge  | JetStream subscribed
```

**If you see red errors → tell me the error ❌**

---

## STEP 9 — Test That Embeddings Work

Open Postman and log in to the bridge to get a token:

```
POST  http://localhost:8000/auth/login
```

Body:
```json
{
  "email": "your@email.com",
  "password": "yourpassword"
}
```

Then test the health endpoint to confirm the bridge is running:
```
GET  http://localhost:8000/health
```

You should see:
```json
{"status": "ok", ...}
```

**Tell me when done ✅**

---

## STEP 10 — Test a Real Document Upload

Go to the admin panel in the browser:
```
http://localhost:3000
```

1. Log in as admin
2. Create an agent (or use an existing one)
3. Upload a small `.txt` file with some text
4. Wait 5 seconds
5. Ask the agent a question about the content in that file

If the agent answers with information from the file → **Ollama embeddings are working** ✅

If it fails → check bridge logs:
```
docker logs webai-bridge --tail=50
```

Tell me what you see in the logs.

---

## What Changed — Summary

```
Before:
  text → Gemini API (cloud) → 768 numbers → PostgreSQL

After:
  text → Ollama (localhost:11434) → 768 numbers → PostgreSQL
```

The database, the index, the search SQL — all exactly the same.
Only the embedding API changed.

---

## Troubleshooting

### "connection refused" when bridge calls Ollama

Ollama is not running. Start it:
```
ollama serve
```

### "model not found" error

The model was not downloaded. Run:
```
ollama pull nomic-embed-text
```

### Docker says "host-gateway" is unknown

Your Docker version may not support `host-gateway`. Use your actual Windows IP instead.

Find your IP:
```
ipconfig
```

Look for `IPv4 Address` under your network adapter (usually something like `192.168.1.x`).

Then in `docker-compose.yml`, change:
```yaml
OLLAMA_URL: http://192.168.1.x:11434
```
(replace with your actual IP)

And remove the `extra_hosts` section.

### Embedding is very slow

The first call to Ollama takes 10–30 seconds because the model loads into RAM.
After that, each call takes 1–3 seconds. This is normal.

### I want to go back to Gemini API

Just revert `vector.py` to the original version and put `GEMINI_API_KEY` back in `.env`.
The database does not care which model made the embeddings — it only stores numbers.

---

## All Steps Summary

```
✅ Step 1 — Install Ollama on Windows
✅ Step 2 — Download nomic-embed-text model
✅ Step 3 — Test Ollama works (curl test)
✅ Step 4 — Replace vector.py embed functions
✅ Step 5 — Add ollama package to requirements.txt
✅ Step 6 — Update .env files
✅ Step 7 — Update docker-compose.yml
✅ Step 8 — Rebuild Docker (docker compose up --build)
✅ Step 9 — Test health endpoint
✅ Step 10 — Upload a document and test search
```

When all 10 are done → embeddings are 100% local, free, and private.

---

## Why nomic-embed-text?

| Model | Size | RAM | Quality | Verdict |
|-------|------|-----|---------|---------|
| `all-minilm` | 46MB | 1GB | Good | Use if you have very little RAM |
| `nomic-embed-text` | 274MB | 2GB | Very good | **Recommended — best balance** |
| `mxbai-embed-large` | 669MB | 3GB | Excellent | Use if you have lots of RAM |

`nomic-embed-text` produces **768 dimensions** — exactly what our database column expects.
No changes to the database schema needed.
