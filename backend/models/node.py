from pydantic import BaseModel, Field
from typing import Any, Optional
from datetime import datetime


class NodeCreate(BaseModel):
    type: str
    label: str
    properties: dict[str, Any] = Field(default_factory=dict)
    is_inbox: bool = False
    labels: list[str] = Field(default_factory=list)


class NodeUpdate(BaseModel):
    label: Optional[str] = None
    type: Optional[str] = None
    type_version: Optional[int] = None
    properties: Optional[dict[str, Any]] = None
    labels: Optional[list[str]] = None


class NodeResponse(BaseModel):
    id: str
    type: str
    type_version: int
    label: str
    created_at: Optional[int] = None
    updated_at: Optional[int] = None
    created_by: str
    has_body: bool
    is_inbox: bool
    archived_at: Optional[int] = 0
    properties: dict[str, Any] = Field(default_factory=dict)
    labels: list[str] = Field(default_factory=list)
