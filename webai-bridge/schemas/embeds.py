# schemas/embeds.py
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


class EmbedCreate(BaseModel):
    agent_id: str
    allowed_domains: List[str] = []
    config: dict = {}


class EmbedUpdate(BaseModel):
    allowed_domains: Optional[List[str]] = None
    config: Optional[dict] = None
    is_active: Optional[bool] = None


class EmbedResponse(BaseModel):
    id: str
    embed_key: str
    agent_id: str
    agent_name: Optional[str] = None
    allowed_domains: List[str]
    config: dict
    is_active: bool
    created_at: datetime
    updated_at: datetime


class EmbedChatMessage(BaseModel):
    """Model + agent come from the embed config, not the client."""
    message: str
