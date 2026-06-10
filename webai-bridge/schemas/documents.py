# schemas/documents.py
from pydantic import BaseModel
from datetime import datetime

class DocumentUploadResponse(BaseModel):
    success: bool
    filename: str
    total_chunks: int
    stored: int
    failed: int
    message: str

class DocumentInfo(BaseModel):
    filename: str
    chunk_count: int
    created_at: datetime

class DocumentListResponse(BaseModel):
    success: bool
    agent_id: str
    documents: list
