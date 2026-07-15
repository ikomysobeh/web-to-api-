# vector.py
import asyncio
import httpx
import logging
import os
import re
import uuid
from typing import List, Optional
from database import get_connection
from cache import make_key, cache_get_json, cache_set_json

logger = logging.getLogger("vector")

# Ollama local embedding — no API key needed, runs on your own machine
OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "nomic-embed-text")
EMBED_DIMENSIONS = 768   # nomic-embed-text produces 768 dims — matches document_chunks.embedding vector(768)

# ─── Ollama concurrency guard ────────────────────────────────────────────────
# Ollama processes embeddings SEQUENTIALLY. If many requests hit it at once,
# latency explodes (2s → 45s+ with just 5 concurrent users). This semaphore
# caps how many embedding calls run at the same time so Ollama never floods.
#
# Set OLLAMA_MAX_CONCURRENCY to match your CPU count (2 on a KVM 2). It MUST be
# paired with OLLAMA_NUM_PARALLEL on the Ollama server side (see Task 3).
OLLAMA_MAX_CONCURRENCY = int(os.getenv("OLLAMA_MAX_CONCURRENCY", "2"))
_embed_semaphore = asyncio.Semaphore(OLLAMA_MAX_CONCURRENCY)

# How long a cached embedding stays valid. The same text always produces the
# same vector for a given model, so this can be long. 24h is plenty and keeps
# the cache from growing forever (LRU eviction handles the rest).
EMBED_CACHE_TTL = int(os.getenv("EMBED_CACHE_TTL", "86400"))

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


# ─── Embedding via Ollama ────────────────────────────────────────────────────

async def embed_text(text: str) -> Optional[List[float]]:
    """
    Return a 768-dimension vector for `text`. Returns None if the call fails.

    Order of operations:
      1. Check the cache — identical text was embedded before → reuse the vector,
         skip Ollama entirely (this is the whole point: fewer Ollama calls).
      2. On a miss, call Ollama (guarded by the semaphore so at most
         OLLAMA_MAX_CONCURRENCY run at once), then store the result in the cache.

    The cache only ever matches the EXACT same text for the EXACT same model, so
    it can never return a wrong vector — 100% safe.
    """
    # 1. Cache lookup (keyed on model + text so changing the model invalidates it)
    cache_key = make_key("embed", OLLAMA_MODEL, text)
    cached = cache_get_json(cache_key)
    if cached is not None:
        return cached

    # 2. Cache miss → call Ollama under the concurrency guard
    try:
        async with _embed_semaphore:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{OLLAMA_URL}/api/embeddings",
                    json={"model": OLLAMA_MODEL, "prompt": text}
                )
                resp.raise_for_status()
                embedding = resp.json()["embedding"]
    except Exception:
        logger.exception(f"Ollama embed_text failed for: {text[:80]}...")
        return None

    # 3. Store for next time (silent no-op if Redis is unavailable)
    cache_set_json(cache_key, embedding, EMBED_CACHE_TTL)
    return embedding


async def embed_query(text: str) -> Optional[List[float]]:
    """Same as embed_text — Ollama uses the same endpoint for queries."""
    return await embed_text(text)


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
    # Count total chunks for this agent first
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as cnt FROM document_chunks WHERE agent_id = %s", (agent_id,))
    total = cursor.fetchone()["cnt"]
    logger.info(f"search_chunks: agent={agent_id} has {total} chunks in DB, query='{query[:60]}'")

    if total == 0:
        logger.warning(f"search_chunks: agent {agent_id} has NO chunks — document may not have been ingested properly")
        cursor.close()
        conn.close()
        return []

    query_vector = await embed_query(query)
    if query_vector is None:
        logger.warning("Could not embed query — returning empty context")
        cursor.close()
        conn.close()
        return []

    embedding_str = "[" + ",".join(str(v) for v in query_vector) + "]"

    cursor.execute("""
        SELECT content, embedding <=> %s::vector AS distance
        FROM document_chunks
        WHERE agent_id = %s
        ORDER BY distance
        LIMIT %s
    """, (embedding_str, agent_id, limit))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    logger.info(f"search_chunks: found {len(rows)} chunks, top distances: {[round(row['distance'], 4) for row in rows]}")
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
