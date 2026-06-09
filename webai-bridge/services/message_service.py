import uuid
from database import get_connection


def _validate_uuid(value: str, label: str = "ID") -> str:
    """Validate that a string is a proper UUID. Raises ValueError if not."""
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError):
        raise ValueError(f"Invalid {label}: '{value}' is not a valid UUID")

def create_message(conversation_id: str, role: str, content: str) -> dict:
    """Create a new message in a conversation."""
    conversation_id = _validate_uuid(conversation_id, "conversation_id")
    conn = get_connection()
    cursor = conn.cursor()
    
    msg_id = str(uuid.uuid4())
    cursor.execute(
        """INSERT INTO conversation_messages (id, conversation_id, role, content)
           VALUES (%s, %s, %s, %s)
           RETURNING id, conversation_id, role, content, created_at""",
        (msg_id, conversation_id, role, content)
    )
    row = cursor.fetchone()
    
    # Update conversation's updated_at
    cursor.execute(
        "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = %s",
        (conversation_id,)
    )
    
    conn.commit()
    cursor.close()
    conn.close()
    
    return {
        "id": row["id"],
        "conversation_id": row["conversation_id"],
        "role": row["role"],
        "content": row["content"],
        "created_at": row["created_at"]
    }

def get_messages(conversation_id: str, user_id: int, limit: int = 50, offset: int = 0) -> tuple:
    """Get messages for a conversation (with user ownership check)."""
    conversation_id = _validate_uuid(conversation_id, "conversation_id")
    conn = get_connection()
    cursor = conn.cursor()
    
    # Verify user owns this conversation
    cursor.execute(
        "SELECT id FROM conversations WHERE id = %s AND user_id = %s",
        (conversation_id, user_id)
    )
    if not cursor.fetchone():
        cursor.close()
        conn.close()
        return [], 0
    
    # Get total count
    cursor.execute(
        "SELECT COUNT(*) as total FROM conversation_messages WHERE conversation_id = %s",
        (conversation_id,)
    )
    total = cursor.fetchone()["total"]
    
    # Get messages
    cursor.execute(
        """SELECT id, conversation_id, role, content, created_at
           FROM conversation_messages
           WHERE conversation_id = %s
           ORDER BY created_at ASC
           LIMIT %s OFFSET %s""",
        (conversation_id, limit, offset)
    )
    rows = cursor.fetchall()
    
    cursor.close()
    conn.close()
    
    messages = []
    for row in rows:
        messages.append({
            "id": row["id"],
            "conversation_id": row["conversation_id"],
            "role": row["role"],
            "content": row["content"],
            "created_at": row["created_at"]
        })
    
    return messages, total

def delete_message(message_id: str, user_id: int) -> bool:
    """Delete a specific message (with user ownership check)."""
    message_id = _validate_uuid(message_id, "message_id")
    conn = get_connection()
    cursor = conn.cursor()
    
    # Verify user owns the conversation this message belongs to
    cursor.execute(
        """DELETE FROM conversation_messages
           WHERE id = %s
           AND conversation_id IN (SELECT id FROM conversations WHERE user_id = %s)""",
        (message_id, user_id)
    )
    
    deleted = cursor.rowcount > 0
    
    if deleted:
        # Update conversation's updated_at
        cursor.execute(
            """UPDATE conversations SET updated_at = CURRENT_TIMESTAMP
               WHERE id IN (
                   SELECT conversation_id FROM conversation_messages WHERE id = %s
               )""",
            (message_id,)
        )
    
    conn.commit()
    cursor.close()
    conn.close()
    
    return deleted
