# schemas/agents.py
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class AgentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    instructions: str                          # behavioral rules — required
    model: str = "gemini-2.5-flash"

class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    model: Optional[str] = None
    is_active: Optional[bool] = None

class AgentResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    instructions: str                          # included for admin view
    model: str
    is_active: bool
    created_by: Optional[int]
    created_at: datetime
    updated_at: datetime

class AgentPublicResponse(BaseModel):
    """What the user (non-admin) sees — instructions are hidden."""
    id: str
    name: str
    description: Optional[str]
    model: str
