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
