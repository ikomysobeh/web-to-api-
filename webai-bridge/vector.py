# vector.py
import httpx
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
# gemini-embedding-001 is the current stable model (replaces text-embedding-004/005).
# It natively outputs 3072 dims, but we request 768 via outputDimensionality so the
# database column (vector(768)) stays compatible with no schema change needed.
EMBED_MODEL = "models/gemini-embedding-001"
EMBED_DIMENSIONS = 768   # must match document_chunks.embedding vector(768)

def _embed_url() -> str:
    """Build the embedding URL at call time so key changes take effect without restart."""
    key = os.getenv("GEMINI_API_KEY", "")
    return f"https://generativelanguage.googleapis.com/v1/{EMBED_MODEL}:embedContent?key={key}"

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
    if not os.getenv("GEMINI_API_KEY", ""):
        logger.error("GEMINI_API_KEY not set — cannot generate embeddings")
        return None

    payload = {
        "model": EMBED_MODEL,
        "content": {"parts": [{"text": text}]},
        "taskType": "RETRIEVAL_DOCUMENT",
        "outputDimensionality": EMBED_DIMENSIONS
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(_embed_url(), json=payload)
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
    if not os.getenv("GEMINI_API_KEY", ""):
        return None

    payload = {
        "model": EMBED_MODEL,
        "content": {"parts": [{"text": text}]},
        "taskType": "RETRIEVAL_QUERY",
        "outputDimensionality": EMBED_DIMENSIONS
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(_embed_url(), json=payload)
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
