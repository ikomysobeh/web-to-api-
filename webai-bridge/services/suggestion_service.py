# services/suggestion_service.py
"""
Suggestion System — generate starter questions for an agent from its documents
(via Gemini, using the admin's own connected account — no API key), let the admin
review/edit/approve, and serve the approved list to users assigned to the agent.

Drafts are NOT persisted: generate_messages/parse_questions produce a list that
lives only in the browser until the admin approves. replace_suggestions() is the
only function that writes to the DB.
"""
import json
import re
import uuid
from typing import List

from database import get_connection

# Keep the document payload sent to Gemini within a safe size.
MAX_DOC_CHARS = 12000
# Hard cap on how many suggestions we ever store for one agent.
MAX_SUGGESTIONS = 20


def _validate_uuid(value: str, label: str = "agent_id") -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError):
        raise ValueError(f"Invalid {label}: '{value}' is not a valid UUID")


# ─── Rebuild document text from chunks ────────────────────────────────────────

def rebuild_agent_document_text(agent_id: str) -> str:
    """
    The original uploaded files are not stored — only their chunked text lives in
    document_chunks. Rebuild a single text blob by joining the chunks in order.
    Truncated to MAX_DOC_CHARS to keep the Gemini prompt within a safe size.
    """
    agent_id = _validate_uuid(agent_id)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT content
           FROM document_chunks
           WHERE agent_id = %s
           ORDER BY filename, chunk_index""",
        (agent_id,),
    )
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    text = "\n\n".join(row["content"] for row in rows if row["content"])
    if len(text) > MAX_DOC_CHARS:
        text = text[:MAX_DOC_CHARS]
    return text


# ─── Build the Gemini prompt ──────────────────────────────────────────────────

def build_suggestion_prompt(agent_name: str, instructions: str,
                            document_text: str, count: int = 6) -> List[dict]:
    """Build the OpenAI-style messages array sent to WebAI-to-API."""
    system = (
        "You generate starter questions for an AI assistant. Given the "
        "assistant's purpose and its knowledge documents, produce the most "
        "useful questions a real user would ask it. Questions must be "
        "answerable from the material, short, and specific. "
        "Return ONLY a JSON array of strings, nothing else."
    )

    doc_block = document_text.strip() or "(no documents provided)"
    user = (
        f"Assistant name: {agent_name}\n"
        f"Assistant purpose / instructions:\n{instructions or '(none)'}\n\n"
        f"Knowledge documents:\n\"\"\"\n{doc_block}\n\"\"\"\n\n"
        f"Write {count} starter questions as a JSON array of strings."
    )

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


# ─── Parse Gemini's reply into a clean list ───────────────────────────────────

def parse_questions(text: str, count: int = 6) -> List[str]:
    """
    Turn Gemini's free-text reply into a clean list of questions.
    1. Try to parse a JSON array.
    2. Fall back to line-by-line parsing (strip numbering / bullets).
    3. De-duplicate, trim, and cap at `count`.
    """
    if not text:
        return []

    questions: List[str] = []

    # 1. Try JSON array first
    try:
        start = text.index("[")
        end = text.rindex("]") + 1
        parsed = json.loads(text[start:end])
        if isinstance(parsed, list):
            questions = [str(q) for q in parsed if str(q).strip()]
    except (ValueError, json.JSONDecodeError):
        questions = []

    # 2. Fallback: line parsing
    if not questions:
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            # strip leading "1.", "1)", "-", "*", "Q:" markers
            line = re.sub(r'^\s*(\d+[\.\)]|[-*•]|Q[:\.])\s*', '', line).strip()
            if line:
                questions.append(line)

    # 3. Clean: strip surrounding quotes, de-dup (case-insensitive), cap
    cleaned: List[str] = []
    seen = set()
    for q in questions:
        q = q.strip().strip('"').strip("'").strip()
        if not q:
            continue
        key = q.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(q)

    return cleaned[:count]


# ─── Saved suggestions (DB read / write) ──────────────────────────────────────

def get_saved_suggestions(agent_id: str) -> List[dict]:
    """Return the approved suggestions for an agent, in display order."""
    agent_id = _validate_uuid(agent_id)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT id, question, sort_order
           FROM agent_suggestions
           WHERE agent_id = %s
           ORDER BY sort_order, created_at""",
        (agent_id,),
    )
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {"id": str(row["id"]), "question": row["question"], "sort_order": row["sort_order"]}
        for row in rows
    ]


def replace_suggestions(agent_id: str, questions: List[str]) -> int:
    """
    Replace ALL saved suggestions for an agent with the approved list.
    Deletes existing rows and inserts the new ones with sort_order.
    Returns the number of suggestions stored.
    """
    agent_id = _validate_uuid(agent_id)
    cleaned = [q.strip() for q in questions if q and q.strip()][:MAX_SUGGESTIONS]

    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM agent_suggestions WHERE agent_id = %s", (agent_id,))
        for i, question in enumerate(cleaned):
            cursor.execute(
                """INSERT INTO agent_suggestions (id, agent_id, question, sort_order)
                   VALUES (%s, %s, %s, %s)""",
                (str(uuid.uuid4()), agent_id, question, i),
            )
        conn.commit()
    finally:
        cursor.close()
        conn.close()

    return len(cleaned)
