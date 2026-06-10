from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List

class ConversationCreate(BaseModel):
    title: Optional[str] = "New Conversation"
    model: str = "gemini-3-flash"
    agent_id: Optional[str] = None

class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    model: Optional[str] = None

class ConversationResponse(BaseModel):
    id: str
    user_id: int
    title: str
    model: str
    agent_id: Optional[str] = None
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
