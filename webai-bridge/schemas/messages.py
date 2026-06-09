from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

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
