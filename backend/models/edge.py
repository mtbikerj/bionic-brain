from pydantic import BaseModel
from typing import Any, Optional


class EdgeCreate(BaseModel):
    from_id: str
    to_id: str
    type: str
    properties: dict[str, Any] = {}


class EdgeResponse(BaseModel):
    id: str
    from_id: str
    to_id: str
    type: str
    created_at: Optional[int] = None
    created_by: str
    properties: dict[str, Any] = {}
