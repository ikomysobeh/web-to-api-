# schemas/suggestions.py
from pydantic import BaseModel
from typing import List, Optional


class GenerateRequest(BaseModel):
    """Body for POST /admin/agents/{id}/suggestions/generate."""
    count: Optional[int] = 6


class SaveRequest(BaseModel):
    """Body for PUT /admin/agents/{id}/suggestions — the approved list."""
    questions: List[str]


class SuggestionOut(BaseModel):
    id: str
    question: str
    sort_order: int
