import uuid
from database import get_connection
from datetime import datetime


def _validate_uuid(value: str, label: str = "ID") -> str:
    """Validate that a string is a proper UUID. Raises ValueError if not."""
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError):
        raise ValueError(f"Invalid {label}: '{value}' is not a valid UUID")

def create_conversation(user_id: int, title: str, model: str) -> dict:
    """Create a new conversation for a user."""
    conn = get_connection()
    cursor = conn.cursor()
    
    conv_id = str(uuid.uuid4())
    cursor.execute(
        """INSERT INTO conversations (id, user_id, title, model)
           VALUES (%s, %s, %s, %s)
           RETURNING id, user_id, title, model, created_at, updated_at""",
        (conv_id, user_id, title, model)
    )
    row = cursor.fetchone()
    
    # Get message count (0 for new conversation)
    cursor.execute(
        "SELECT COUNT(*) as count FROM conversation_messages WHERE conversation_id = %s",
        (conv_id,)
    )
    count_row = cursor.fetchone()
    
    conn.commit()
    cursor.close()
    conn.close()
    
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "title": row["title"],
        "model": row["model"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "message_count": count_row["count"]
    }

def get_conversations(user_id: int, limit: int = 20, offset: int = 0) -> tuple:
    """Get all conversations for a user with pagination."""
    conn = get_connection()
    cursor = conn.cursor()
    
    # Get total count
    cursor.execute(
        "SELECT COUNT(*) as total FROM conversations WHERE user_id = %s",
        (user_id,)
    )
    total = cursor.fetchone()["total"]
    
    # Get conversations with message counts
    cursor.execute(
        """SELECT c.id, c.user_id, c.title, c.model, c.created_at, c.updated_at,
                  COUNT(cm.id) as message_count
           FROM conversations c
           LEFT JOIN conversation_messages cm ON c.id = cm.conversation_id
           WHERE c.user_id = %s
           GROUP BY c.id
           ORDER BY c.updated_at DESC
           LIMIT %s OFFSET %s""",
        (user_id, limit, offset)
    )
    rows = cursor.fetchall()
    
    cursor.close()
    conn.close()
    
    conversations = []
    for row in rows:
        conversations.append({
            "id": row["id"],
            "user_id": row["user_id"],
            "title": row["title"],
            "model": row["model"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "message_count": row["message_count"]
        })
    
    return conversations, total

def get_conversation(conversation_id: str, user_id: int) -> dict:
    """Get a specific conversation by ID (with user ownership check)."""
    conversation_id = _validate_uuid(conversation_id, "conversation_id")
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        """SELECT id, user_id, title, model, created_at, updated_at
           FROM conversations
           WHERE id = %s AND user_id = %s""",
        (conversation_id, user_id)
    )
    row = cursor.fetchone()
    
    if not row:
        cursor.close()
        conn.close()
        return None
    
    # Get message count
    cursor.execute(
        "SELECT COUNT(*) as count FROM conversation_messages WHERE conversation_id = %s",
        (conversation_id,)
    )
    count_row = cursor.fetchone()
    
    cursor.close()
    conn.close()
    
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "title": row["title"],
        "model": row["model"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "message_count": count_row["count"]
    }

def update_conversation(conversation_id: str, user_id: int, title: str = None, model: str = None) -> dict:
    """Update conversation title or model."""
    conversation_id = _validate_uuid(conversation_id, "conversation_id")
    conn = get_connection()
    cursor = conn.cursor()
    
    # Build update query dynamically
    updates = []
    params = []
    
    if title:
        updates.append("title = %s")
        params.append(title)
    if model:
        updates.append("model = %s")
        params.append(model)
    
    if not updates:
        cursor.close()
        conn.close()
        return get_conversation(conversation_id, user_id)
    
    updates.append("updated_at = CURRENT_TIMESTAMP")
    params.extend([conversation_id, user_id])
    
    cursor.execute(
        f"""UPDATE conversations
           SET {', '.join(updates)}
           WHERE id = %s AND user_id = %s
           RETURNING id, user_id, title, model, created_at, updated_at""",
        params
    )
    row = cursor.fetchone()
    
    conn.commit()
    cursor.close()
    conn.close()
    
    if not row:
        return None
    
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "title": row["title"],
        "model": row["model"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "message_count": 0  # Would need to fetch if needed
    }

def delete_conversation(conversation_id: str, user_id: int) -> bool:
    """Delete a conversation ( CASCADE will delete messages too)."""
    conversation_id = _validate_uuid(conversation_id, "conversation_id")
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        "DELETE FROM conversations WHERE id = %s AND user_id = %s",
        (conversation_id, user_id)
    )
    
    deleted = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    
    return deleted

def delete_all_conversations(user_id: int) -> int:
    """Delete all conversations for a user."""
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        "DELETE FROM conversations WHERE user_id = %s",
        (user_id,)
    )
    
    deleted_count = cursor.rowcount
    conn.commit()
    cursor.close()
    conn.close()
    
    return deleted_count
