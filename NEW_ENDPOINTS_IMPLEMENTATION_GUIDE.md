# New API Endpoints Implementation Guide

> Step-by-step guide for implementing the new backend endpoints to support conversation persistence and enhanced features.

---

## Overview

This guide covers implementing the new endpoints suggested in the frontend integration document. These endpoints will enable:
- Conversation persistence (save/load/delete conversations)
- Message history storage
- Model information endpoint
- User profile/preferences
- Enhanced Gemini status

---

## New Backend Structure

### File Structure Changes

```
webai-bridge/
├── main.py                 # Add new routes here
├── auth.py                 # No changes needed
├── database.py             # Add new tables to init_db()
├── models.py               # Add new data classes
├── requirements.txt       # No changes needed (already has dependencies)
├── services/
│   ├── cookie_service.py   # No changes needed
│   ├── conversation_service.py  # NEW: Conversation CRUD operations
│   └── message_service.py        # NEW: Message CRUD operations
└── schemas/                # NEW: Pydantic schemas
    ├── conversations.py    # NEW: Conversation request/response models
    ├── messages.py         # NEW: Message request/response models
    ├── users.py            # NEW: User profile models
    └── models.py           # NEW: Model information models
```

---

## Phase 1: Database Schema Updates

### Update `database.py`

Add these tables to the `init_db()` function:

```python
# Add to init_db() after existing tables

# conversations table
cursor.execute("""
    CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT 'gemini-3-flash',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
""")

# conversation_messages table
cursor.execute("""
    CREATE TABLE IF NOT EXISTS conversation_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
""")

# user_preferences table
cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL,
        default_model TEXT DEFAULT 'gemini-3-flash',
        theme TEXT DEFAULT 'dark',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
""")
```

**Note:** Requires `uuid-ossp` extension for `gen_random_uuid()`. Add this before table creation:

```python
cursor.execute("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")
```

---

## Phase 2: Create Pydantic Schemas

### Create `schemas/conversations.py`

```python
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List
import uuid

class ConversationCreate(BaseModel):
    title: Optional[str] = "New Conversation"
    model: str = "gemini-3-flash"

class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    model: Optional[str] = None

class ConversationResponse(BaseModel):
    id: str
    user_id: int
    title: str
    model: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0

class ConversationListResponse(BaseModel):
    success: bool
    conversations: List[ConversationResponse]
    total: int

class ConversationDetailResponse(BaseModel):
    success: bool
    conversation: ConversationResponse
    messages: List["MessageResponse"]
```

### Create `schemas/messages.py`

```python
from pydantic import BaseModel
from datetime import datetime
from typing import List

class MessageCreate(BaseModel):
    message: str
    model: Optional[str] = None

class MessageResponse(BaseModel):
    id: str
    conversation_id: str
    role: str  # "user" or "assistant"
    content: str
    created_at: datetime

class MessageListResponse(BaseModel):
    success: bool
    messages: List[MessageResponse]
    total: int
```

### Create `schemas/users.py`

```python
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
    created_at: datetime
    last_login: Optional[datetime] = None
    preferences: dict
```

### Create `schemas/models.py`

```python
from pydantic import BaseModel
from typing import List, Optional

class ModelInfo(BaseModel):
    id: str
    name: str
    description: str
    contextWindow: str
    badge: Optional[str] = None
    available: bool

class ModelsResponse(BaseModel):
    success: bool
    models: List[ModelInfo]
```

---

## Phase 3: Create Service Layer

### Create `services/conversation_service.py`

```python
import uuid
from database import get_connection
from datetime import datetime

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
```

### Create `services/message_service.py`

```python
import uuid
from database import get_connection

def create_message(conversation_id: str, role: str, content: str) -> dict:
    """Create a new message in a conversation."""
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
```

---

## Phase 4: Add Routes to `main.py`

### Add imports at top of `main.py`

```python
# Add these imports
import uuid
from schemas.conversations import (
    ConversationCreate, ConversationUpdate, 
    ConversationResponse, ConversationListResponse, ConversationDetailResponse
)
from schemas.messages import MessageCreate, MessageResponse, MessageListResponse
from schemas.users import UserPreferencesUpdate, UserProfileResponse
from schemas.models import ModelInfo, ModelsResponse
from services.conversation_service import (
    create_conversation, get_conversations, get_conversation,
    update_conversation, delete_conversation, delete_all_conversations
)
from services.message_service import (
    create_message, get_messages, delete_message
)
```

### Add Conversation Routes

```python
# GET /api/conversations - List user's conversations
@app.get("/api/conversations", dependencies=[Depends(get_current_user)])
def list_conversations(
    limit: int = 20,
    offset: int = 0,
    user = Depends(get_current_user)
):
    """
    List all conversations for the authenticated user with pagination.
    """
    conversations, total = get_conversations(user["user_id"], limit, offset)
    return {
        "success": True,
        "conversations": conversations,
        "total": total
    }

# POST /api/conversations - Create new conversation
@app.post("/api/conversations", dependencies=[Depends(get_current_user)])
def create_new_conversation(
    data: ConversationCreate,
    user = Depends(get_current_user)
):
    """
    Create a new conversation session.
    """
    conversation = create_conversation(
        user["user_id"],
        data.title or "New Conversation",
        data.model
    )
    return {
        "success": True,
        "conversation": conversation
    }

# GET /api/conversations/{id} - Get specific conversation
@app.get("/api/conversations/{conversation_id}", dependencies=[Depends(get_current_user)])
def get_conversation_detail(
    conversation_id: str,
    user = Depends(get_current_user)
):
    """
    Get a specific conversation with its messages.
    """
    conversation = get_conversation(conversation_id, user["user_id"])
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Get messages for this conversation
    messages, _ = get_messages(conversation_id, user["user_id"])
    
    return {
        "success": True,
        "conversation": conversation,
        "messages": messages
    }

# PUT /api/conversations/{id} - Update conversation
@app.put("/api/conversations/{conversation_id}", dependencies=[Depends(get_current_user)])
def update_conversation_endpoint(
    conversation_id: str,
    data: ConversationUpdate,
    user = Depends(get_current_user)
):
    """
    Update conversation title or model.
    """
    conversation = update_conversation(
        conversation_id,
        user["user_id"],
        data.title,
        data.model
    )
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return {
        "success": True,
        "conversation": conversation
    }

# DELETE /api/conversations/{id} - Delete conversation
@app.delete("/api/conversations/{conversation_id}", dependencies=[Depends(get_current_user)])
def delete_conversation_endpoint(
    conversation_id: str,
    user = Depends(get_current_user)
):
    """
    Delete a specific conversation.
    """
    deleted = delete_conversation(conversation_id, user["user_id"])
    
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return {"success": True, "message": "Conversation deleted"}

# DELETE /api/conversations - Delete all conversations
@app.delete("/api/conversations", dependencies=[Depends(get_current_user)])
def delete_all_conversations_endpoint(user = Depends(get_current_user)):
    """
    Delete all conversations for the authenticated user.
    """
    deleted_count = delete_all_conversations(user["user_id"])
    return {
        "success": True,
        "deleted_count": deleted_count,
        "message": f"Deleted {deleted_count} conversations"
    }
```

### Add Message Routes

```python
# POST /api/conversations/{id}/messages - Send message in conversation
@app.post("/api/conversations/{conversation_id}/messages", dependencies=[Depends(get_current_user)])
async def send_message(
    conversation_id: str,
    data: MessageCreate,
    user = Depends(get_current_user)
):
    """
    Send a message in a conversation and stream the response.
    Saves both user message and assistant response to database.
    """
    # Verify conversation belongs to user
    conversation = get_conversation(conversation_id, user["user_id"])
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Save user message to database
    create_message(conversation_id, "user", data.message)
    
    # Stream response from WebAI-to-API (similar to existing /api/chat)
    model = data.model or conversation["model"]
    user_id_str = str(user["user_id"])
    
    request_body = {
        "model": model,
        "stream": True,
        "messages": [{"role": "user", "content": data.message}]
    }
    
    async def stream_from_webai():
        assistant_content = ""
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{WEBAI_URL}/v1/chat/completions",
                    json=request_body,
                    headers={
                        "Content-Type": "application/json",
                        "X-Internal-Key": WEBAI_INTERNAL_KEY,
                        "X-Internal-User-ID": user_id_str,
                    }
                ) as response:
                    if response.status_code != 200:
                        error = await response.aread()
                        yield f"data: {json.dumps({'error': error.decode()})}\n\n"
                        return
                    
                    async for line in response.aiter_lines():
                        if line:
                            yield f"{line}\n\n"
                            # Extract content for saving to database
                            if line.startswith("data: ") and line != "data: [DONE]":
                                try:
                                    data_json = json.loads(line[6:])
                                    if "choices" in data_json and len(data_json["choices"]) > 0:
                                        delta = data_json["choices"][0].get("delta", {})
                                        if "content" in delta:
                                            assistant_content += delta["content"]
                                except:
                                    pass
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            # Save assistant message to database after streaming completes
            if assistant_content:
                create_message(conversation_id, "assistant", assistant_content)
    
    return StreamingResponse(
        stream_from_webai(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )

# GET /api/conversations/{id}/messages - Get conversation messages
@app.get("/api/conversations/{conversation_id}/messages", dependencies=[Depends(get_current_user)])
def list_messages(
    conversation_id: str,
    limit: int = 50,
    offset: int = 0,
    user = Depends(get_current_user)
):
    """
    Get messages for a conversation with pagination.
    """
    messages, total = get_messages(conversation_id, user["user_id"], limit, offset)
    return {
        "success": True,
        "messages": messages,
        "total": total
    }

# DELETE /api/conversations/{id}/messages/{message_id} - Delete message
@app.delete("/api/conversations/{conversation_id}/messages/{message_id}", dependencies=[Depends(get_current_user)])
def delete_message_endpoint(
    conversation_id: str,
    message_id: str,
    user = Depends(get_current_user)
):
    """
    Delete a specific message from a conversation.
    """
    deleted = delete_message(message_id, user["user_id"])
    
    if not deleted:
        raise HTTPException(status_code=404, detail="Message not found")
    
    return {"success": True, "message": "Message deleted"}
```

### Add Model Information Route

```python
# GET /api/models - List available models
@app.get("/api/models", dependencies=[Depends(get_current_user)])
def list_models(user = Depends(get_current_user)):
    """
    List available Gemini models.
    In production, this could query WebAI-to-API for available models.
    """
    # Check if user has Gemini connection
    from services.cookie_service import has_cookies
    connected = has_cookies(user["user_id"])
    
    models = [
        {
            "id": "gemini-3-flash",
            "name": "Gemini 3 Flash",
            "description": "Fast and efficient model for quick responses",
            "contextWindow": "1M tokens",
            "badge": "Fast",
            "available": connected
        },
        {
            "id": "gemini-3-pro",
            "name": "Gemini 3 Pro",
            "description": "Advanced model for complex tasks",
            "contextWindow": "2M tokens",
            "badge": "Pro",
            "available": connected
        }
    ]
    
    return {
        "success": True,
        "models": models
    }
```

### Add User Profile Routes

```python
# GET /api/user/profile - Get user profile
@app.get("/api/user/profile", dependencies=[Depends(get_current_user)])
def get_user_profile(user = Depends(get_current_user)):
    """
    Get user profile and preferences.
    """
    from database import get_connection
    
    conn = get_connection()
    cursor = conn.cursor()
    
    # Get user info
    cursor.execute(
        "SELECT id, email, created_at FROM users WHERE id = %s",
        (user["user_id"],)
    )
    user_row = cursor.fetchone()
    
    # Get user preferences
    cursor.execute(
        """SELECT default_model, theme FROM user_preferences WHERE user_id = %s""",
        (user["user_id"],)
    )
    pref_row = cursor.fetchone()
    
    cursor.close()
    conn.close()
    
    preferences = {}
    if pref_row:
        preferences = {
            "default_model": pref_row["default_model"],
            "theme": pref_row["theme"]
        }
    else:
        # Create default preferences
        preferences = {"default_model": "gemini-3-flash", "theme": "dark"}
        cursor = get_connection().cursor()
        cursor.execute(
            """INSERT INTO user_preferences (user_id, default_model, theme)
               VALUES (%s, %s, %s)""",
            (user["user_id"], "gemini-3-flash", "dark")
        )
        get_connection().commit()
        cursor.close()
    
    return {
        "success": True,
        "user": {
            "user_id": user_row["id"],
            "email": user_row["email"],
            "created_at": user_row["created_at"],
            "last_login": None,
            "preferences": preferences
        }
    }

# PUT /api/user/profile - Update user preferences
@app.put("/api/user/profile", dependencies=[Depends(get_current_user)])
def update_user_profile(
    data: UserPreferencesUpdate,
    user = Depends(get_current_user)
):
    """
    Update user preferences.
    """
    from database import get_connection
    
    conn = get_connection()
    cursor = conn.cursor()
    
    # Check if preferences exist
    cursor.execute(
        "SELECT id FROM user_preferences WHERE user_id = %s",
        (user["user_id"],)
    )
    existing = cursor.fetchone()
    
    if existing:
        # Update
        updates = []
        params = []
        
        if data.default_model:
            updates.append("default_model = %s")
            params.append(data.default_model)
        if data.theme:
            updates.append("theme = %s")
            params.append(data.theme)
        
        if updates:
            updates.append("updated_at = CURRENT_TIMESTAMP")
            params.append(user["user_id"])
            
            cursor.execute(
                f"""UPDATE user_preferences
                   SET {', '.join(updates)}
                   WHERE user_id = %s""",
                params
            )
    else:
        # Create
        cursor.execute(
            """INSERT INTO user_preferences (user_id, default_model, theme)
               VALUES (%s, %s, %s)""",
            (user["user_id"], data.default_model or "gemini-3-flash", data.theme or "dark")
        )
    
    conn.commit()
    cursor.close()
    conn.close()
    
    return {"success": True, "message": "Preferences updated"}

# POST /api/user/logout - Explicit logout
@app.post("/api/user/logout", dependencies=[Depends(get_current_user)])
def logout(user = Depends(get_current_user)):
    """
    Explicit logout endpoint.
    Frontend should clear the token from localStorage.
    """
    # In future, could add token blacklist or session cleanup
    return {"success": True, "message": "Logged out successfully"}
```

### Add Enhanced Gemini Status Route

```python
# GET /api/gemini/status - Enhanced Gemini status
@app.get("/api/gemini/status", dependencies=[Depends(get_current_user)])
def gemini_status_enhanced(user = Depends(get_current_user)):
    """
    Get Gemini connection status with available models.
    """
    from services.cookie_service import has_cookies
    
    connected = has_cookies(user["user_id"])
    
    available_models = []
    if connected:
        available_models = ["gemini-3-flash", "gemini-3-pro"]
    
    return {
        "success": True,
        "connected": connected,
        "user_id": user["user_id"],
        "message": "Gemini connected" if connected else "No Gemini session found",
        "available_models": available_models
    }

# POST /api/gemini/disconnect - Disconnect Gemini (semantic alias)
@app.post("/api/gemini/disconnect", dependencies=[Depends(get_current_user)])
async def disconnect_gemini_semantic(user = Depends(get_current_user)):
    """
    Disconnect Gemini (semantic alias for DELETE /api/cookies).
    """
    from services.cookie_service import delete_cookies
    
    delete_cookies(user["user_id"])
    await remove_webai_client_for_user(user["user_id"])
    
    return {"success": True, "message": "Gemini disconnected"}
```

---

## Implementation Checklist

### Phase 1: Database
- [ ] Add `uuid-ossp` extension to `database.py`
- [ ] Add `conversations` table to `init_db()`
- [ ] Add `conversation_messages` table to `init_db()`
- [ ] Add `user_preferences` table to `init_db()`
- [ ] Test database migration (restart server)

### Phase 2: Schemas
- [ ] Create `schemas/` directory
- [ ] Create `schemas/conversations.py`
- [ ] Create `schemas/messages.py`
- [ ] Create `schemas/users.py`
- [ ] Create `schemas/models.py`
- [ ] Create `schemas/__init__.py` (empty)

### Phase 3: Services
- [ ] Create `services/conversation_service.py`
- [ ] Create `services/message_service.py`
- [ ] Test service functions manually

### Phase 4: Routes
- [ ] Add imports to `main.py`
- [ ] Add conversation CRUD routes
- [ ] Add message routes
- [ ] Add models endpoint
- [ ] Add user profile routes
- [ ] Add enhanced Gemini status routes
- [ ] Test all endpoints with Swagger UI

### Phase 5: Testing
- [ ] Test conversation creation
- [ ] Test conversation listing
- [ ] Test message sending with streaming
- [ ] Test message history retrieval
- [ ] Test conversation deletion
- [ ] Test user preferences
- [ ] Test models endpoint

---

## Testing the New Endpoints

### Using Swagger UI
Navigate to `http://localhost:8000/docs` after starting the server.

### Example cURL Commands

```bash
# Get auth token first
TOKEN="your_jwt_token_here"

# Create conversation
curl -X POST http://localhost:8000/api/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Chat","model":"gemini-3-flash"}'

# List conversations
curl -X GET http://localhost:8000/api/conversations \
  -H "Authorization: Bearer $TOKEN"

# Send message in conversation (replace CONVERSATION_ID)
curl -X POST http://localhost:8000/api/conversations/CONVERSATION_ID/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello!"}'

# Get conversation messages
curl -X GET http://localhost:8000/api/conversations/CONVERSATION_ID/messages \
  -H "Authorization: Bearer $TOKEN"

# Get user profile
curl -X GET http://localhost:8000/api/user/profile \
  -H "Authorization: Bearer $TOKEN"

# List models
curl -X GET http://localhost:8000/api/models \
  -H "Authorization: Bearer $TOKEN"
```

---

## Notes

1. **UUID Generation**: Uses PostgreSQL's `gen_random_uuid()` for unique IDs
2. **CASCADE Delete**: Deleting a conversation automatically deletes its messages
3. **User Isolation**: All queries include `user_id` to prevent cross-user data access
4. **Streaming**: The message endpoint streams responses while saving to database
5. **Pagination**: All list endpoints support `limit` and `offset` query parameters
6. **Default Values**: Conversations default to "gemini-3-flash" model if not specified

---

**Document Version:** 1.0  
**Last Updated:** 2026-06-08  
**Status:** Ready for Implementation
