# models.py

from dataclasses import dataclass
from typing import Optional


@dataclass
class User:
    """
    Like App\Models\User in Laravel.
    """
    id: int
    email: str
    password_hash: str
    created_at: Optional[str] = None


@dataclass
class UserGeminiCookie:
    """
    Stores encrypted cookies for one user.
    Like a pivot/detail table in Laravel.
    """
    id: int
    user_id: int
    psid_encrypted: str
    psidts_encrypted: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
