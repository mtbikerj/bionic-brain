from pydantic import BaseModel
from typing import Any, Literal, Optional


class FieldDefinition(BaseModel):
    name: str
    type: str  # short_text, long_text, number, currency, date, datetime, boolean, choice_single, choice_multi, relationship, file, url, computed
    required: bool = False
    options: Optional[list[str]] = None  # for choice fields
    default: Optional[Any] = None
    target_type: Optional[str] = None  # for relationship fields


class EdgeTypeDefinition(BaseModel):
    name: str                          # e.g. GRADED_BY
    inverse: Optional[str] = None      # e.g. GRADED
    target_type: Optional[str] = None  # e.g. PERSON
    properties: list[FieldDefinition] = []


class TypeDefinitionCreate(BaseModel):
    name: str
    fields: list[FieldDefinition] = []
    color: str = "#6b7280"
    icon: str = "node"
    extends: Optional[str] = None
    edge_types: list[EdgeTypeDefinition] = []


class TypeDefinitionUpdate(BaseModel):
    fields: Optional[list[FieldDefinition]] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    edge_types: Optional[list[EdgeTypeDefinition]] = None
    extends: Optional[str] = None  # check model_fields_set to distinguish "not provided" vs "clear"


class TypeDefinitionResponse(BaseModel):
    name: str
    is_builtin: bool
    fields: list[FieldDefinition]
    color: str
    icon: str
    version: int
    extends: Optional[str] = None
    node_count: int = 0
    edge_types: list[EdgeTypeDefinition] = []


class MigrateRequest(BaseModel):
    action: Literal["leave", "upgrade"]
    new_version: int
    defaults: dict[str, Any] = {}
