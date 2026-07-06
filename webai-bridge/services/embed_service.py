# services/embed_service.py
"""
Embeddable chat widgets. An admin creates an embed_config (an agent + appearance +
allowed host domains) and gets an embed_key. External sites load the widget with that
key; the embed key itself grants chat access (no per-user agent assignment needed).
"""
import json
import secrets
import uuid
from urllib.parse import urlparse
from typing import Optional

import psycopg2.extras
from database import get_connection


def generate_embed_key() -> str:
    return "emb_" + secrets.token_urlsafe(9)


def _validate_uuid(value: str, label: str = "id") -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError):
        raise ValueError(f"Invalid {label}: '{value}' is not a valid UUID")


def _row_to_embed(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "embed_key": row["embed_key"],
        "agent_id": str(row["agent_id"]),
        "agent_name": row.get("agent_name"),
        "allowed_domains": row.get("allowed_domains") or [],
        "config": row.get("config") or {},
        "is_active": row["is_active"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# ─── CRUD ─────────────────────────────────────────────────────────────────────

def create_embed(agent_id: str, created_by: int, allowed_domains: list, config: dict) -> dict:
    agent_id = _validate_uuid(agent_id, "agent_id")
    embed_key = generate_embed_key()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO embed_configs (id, embed_key, agent_id, created_by, allowed_domains, config)
           VALUES (%s, %s, %s, %s, %s, %s)
           RETURNING *""",
        (str(uuid.uuid4()), embed_key, agent_id, created_by,
         allowed_domains, psycopg2.extras.Json(config)),
    )
    row = cursor.fetchone()
    conn.commit()
    cursor.close()
    conn.close()
    return _with_agent_name(_row_to_embed(row))


def list_embeds(agent_id: Optional[str] = None) -> list:
    conn = get_connection()
    cursor = conn.cursor()
    if agent_id:
        agent_id = _validate_uuid(agent_id, "agent_id")
        cursor.execute(
            """SELECT e.*, a.name AS agent_name
               FROM embed_configs e
               JOIN agents a ON a.id = e.agent_id
               WHERE e.agent_id = %s
               ORDER BY e.created_at DESC""",
            (agent_id,),
        )
    else:
        cursor.execute(
            """SELECT e.*, a.name AS agent_name
               FROM embed_configs e
               JOIN agents a ON a.id = e.agent_id
               ORDER BY e.created_at DESC"""
        )
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [_row_to_embed(r) for r in rows]


def get_embed(embed_id: str) -> Optional[dict]:
    embed_id = _validate_uuid(embed_id, "embed_id")
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT e.*, a.name AS agent_name
           FROM embed_configs e
           JOIN agents a ON a.id = e.agent_id
           WHERE e.id = %s""",
        (embed_id,),
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    return _row_to_embed(row) if row else None


def get_embed_by_key(embed_key: str) -> Optional[dict]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT e.*, a.name AS agent_name
           FROM embed_configs e
           JOIN agents a ON a.id = e.agent_id
           WHERE e.embed_key = %s""",
        (embed_key,),
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    return _row_to_embed(row) if row else None


def update_embed(embed_id: str, allowed_domains=None, config=None, is_active=None) -> Optional[dict]:
    embed_id = _validate_uuid(embed_id, "embed_id")
    updates, params = [], []
    if allowed_domains is not None:
        updates.append("allowed_domains = %s")
        params.append(allowed_domains)
    if config is not None:
        updates.append("config = %s")
        params.append(psycopg2.extras.Json(config))
    if is_active is not None:
        updates.append("is_active = %s")
        params.append(is_active)
    if not updates:
        return get_embed(embed_id)
    updates.append("updated_at = NOW()")
    params.append(embed_id)

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        f"UPDATE embed_configs SET {', '.join(updates)} WHERE id = %s RETURNING *",
        params,
    )
    row = cursor.fetchone()
    conn.commit()
    cursor.close()
    conn.close()
    if not row:
        return None
    return _with_agent_name(_row_to_embed(row))


def soft_delete_embed(embed_id: str) -> bool:
    embed_id = _validate_uuid(embed_id, "embed_id")
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE embed_configs SET is_active = false, updated_at = NOW() WHERE id = %s",
        (embed_id,),
    )
    found = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return found


def _with_agent_name(embed: dict) -> dict:
    """Fill agent_name for rows returned by INSERT/UPDATE (no join available)."""
    if embed.get("agent_name"):
        return embed
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM agents WHERE id = %s", (embed["agent_id"],))
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    embed["agent_name"] = row["name"] if row else None
    return embed


# ─── Origin check ─────────────────────────────────────────────────────────────

def origin_allowed(embed: dict, origin_header: Optional[str]) -> bool:
    """
    True if the request Origin is allowed for this embed.
    An empty allowed_domains list means "allow any origin" (dev convenience —
    lock this down per-widget in production).
    """
    allowed = embed.get("allowed_domains") or []
    if not allowed:
        return True
    if not origin_header:
        return False
    host = urlparse(origin_header).hostname or ""
    for entry in allowed:
        entry = entry.strip().lower()
        if not entry:
            continue
        # accept either a bare host ("example.com") or a full origin
        entry_host = urlparse(entry).hostname or entry
        if host == entry_host.lower():
            return True
    return False
