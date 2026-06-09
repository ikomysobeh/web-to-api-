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
