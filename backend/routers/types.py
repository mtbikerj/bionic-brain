import json
import time
import uuid
from fastapi import APIRouter, HTTPException
from backend.db.connection import get_db, get_nodes_collection
from backend.models.types import (
    TypeDefinitionCreate, TypeDefinitionUpdate, TypeDefinitionResponse,
    FieldDefinition, EdgeTypeDefinition, MigrateRequest,
)

router = APIRouter(prefix="/types", tags=["types"])


def _now() -> int:
    return int(time.time() * 1000)


def _record_schema_version(type_name: str, version: int, changes: str):
    now = _now()
    sv_id = str(uuid.uuid4())
    label = f"{type_name} v{version}"
    col = get_nodes_collection()
    col.add(
        ids=[sv_id],
        documents=[label],
        metadatas=[{
            "type": "SCHEMA_VERSION", "type_version": 1, "label": label,
            "created_at": now, "updated_at": now, "created_by": "system",
            "has_body": 0, "is_inbox": 0, "labels": "[]",
            "properties": json.dumps({"type_name": type_name, "version": version, "changes": changes}),
        }],
    )


def _row_to_type(row: dict, node_count: int = 0) -> TypeDefinitionResponse:
    try:
        fields = [FieldDefinition(**f) for f in json.loads(row.get("fields") or "[]")]
    except Exception:
        fields = []
    try:
        edge_types = [EdgeTypeDefinition(**e) for e in json.loads(row.get("edge_types") or "[]")]
    except Exception:
        edge_types = []
    return TypeDefinitionResponse(
        name=row["name"],
        is_builtin=bool(row["is_builtin"]),
        fields=fields,
        color=row.get("color") or "#6b7280",
        icon=row.get("icon") or "node",
        version=row.get("version") or 1,
        extends=row.get("extends"),
        node_count=node_count,
        edge_types=edge_types,
    )


def _get_node_count(type_name: str) -> int:
    col = get_nodes_collection()
    return len(col.get(where={"type": type_name}, include=[])["ids"])


@router.get("", response_model=list[TypeDefinitionResponse])
def list_types():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM type_definitions ORDER BY is_builtin DESC, name ASC"
        ).fetchall()

    col = get_nodes_collection()
    all_metas = col.get(include=["metadatas"])
    type_counts: dict[str, int] = {}
    for meta in all_metas["metadatas"]:
        t = meta.get("type", "")
        type_counts[t] = type_counts.get(t, 0) + 1

    return [_row_to_type(dict(r), type_counts.get(r["name"], 0)) for r in rows]


@router.get("/{name}", response_model=TypeDefinitionResponse)
def get_type(name: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM type_definitions WHERE name=?", (name,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Type '{name}' not found")
    return _row_to_type(dict(row), _get_node_count(name))


@router.post("", response_model=TypeDefinitionResponse, status_code=201)
def create_type(body: TypeDefinitionCreate):
    now = _now()
    name = body.name.upper().replace(" ", "_")

    with get_db() as conn:
        if conn.execute("SELECT name FROM type_definitions WHERE name=?", (name,)).fetchone():
            raise HTTPException(status_code=409, detail=f"Type '{name}' already exists")

        extends = body.extends.upper() if body.extends else None
        if extends:
            parent = conn.execute(
                "SELECT name, extends FROM type_definitions WHERE name=?", (extends,)
            ).fetchone()
            if not parent:
                raise HTTPException(status_code=400, detail=f"Parent type '{extends}' not found")
            if parent["extends"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot extend '{extends}' — it already extends '{parent['extends']}'. Only one level of inheritance is allowed.",
                )

        conn.execute(
            "INSERT INTO type_definitions (name, is_builtin, fields, edge_types, color, icon, version, extends, created_at) "
            "VALUES (?, 0, ?, ?, ?, ?, 1, ?, ?)",
            (
                name,
                json.dumps([f.model_dump() for f in body.fields]),
                json.dumps([e.model_dump() for e in body.edge_types]),
                body.color,
                body.icon,
                extends,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM type_definitions WHERE name=?", (name,)).fetchone()

    return _row_to_type(dict(row), 0)


@router.patch("/{name}", response_model=TypeDefinitionResponse)
def update_type(name: str, body: TypeDefinitionUpdate):
    now = _now()

    with get_db() as conn:
        row = conn.execute("SELECT * FROM type_definitions WHERE name=?", (name,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Type '{name}' not found")

        td = dict(row)
        updates: dict = {}
        new_version = td["version"]
        changes_str = ""

        if body.fields is not None:
            old_names = {f["name"] for f in json.loads(td.get("fields") or "[]")}
            new_names = {f["name"] for f in [f.model_dump() for f in body.fields]}
            added = sorted(new_names - old_names)
            removed = sorted(old_names - new_names)
            parts = [f"+{n}" for n in added] + [f"-{n}" for n in removed]
            changes_str = ", ".join(parts) if parts else "fields updated"
            updates["fields"] = json.dumps([f.model_dump() for f in body.fields])
            new_version = td["version"] + 1
            updates["version"] = new_version

        if body.color is not None:
            updates["color"] = body.color
        if body.icon is not None:
            updates["icon"] = body.icon
        if body.edge_types is not None:
            updates["edge_types"] = json.dumps([e.model_dump() for e in body.edge_types])

        if "extends" in body.model_fields_set:
            new_extends = body.extends.upper() if body.extends else None
            if new_extends:
                parent = conn.execute(
                    "SELECT name, extends FROM type_definitions WHERE name=?", (new_extends,)
                ).fetchone()
                if not parent:
                    raise HTTPException(status_code=400, detail=f"Parent type '{new_extends}' not found")
                if parent["extends"]:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Cannot extend '{new_extends}' — it already extends '{parent['extends']}'. Only one level of inheritance is allowed.",
                    )
                child = conn.execute(
                    "SELECT name FROM type_definitions WHERE extends=?", (name,)
                ).fetchone()
                if child:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Cannot set a parent on '{name}' — it is already a parent of '{child['name']}'. Only one level of inheritance is allowed.",
                    )
            updates["extends"] = new_extends

        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            conn.execute(
                f"UPDATE type_definitions SET {set_clause} WHERE name=?",
                list(updates.values()) + [name],
            )

        row = conn.execute("SELECT * FROM type_definitions WHERE name=?", (name,)).fetchone()

    if body.fields is not None:
        _record_schema_version(name, new_version, changes_str)

    return _row_to_type(dict(row), _get_node_count(name))


@router.post("/{name}/migrate")
def migrate_type(name: str, body: MigrateRequest):
    if body.action == "leave":
        return {"migrated": 0}

    with get_db() as conn:
        if not conn.execute("SELECT name FROM type_definitions WHERE name=?", (name,)).fetchone():
            raise HTTPException(status_code=404, detail=f"Type '{name}' not found")

    col = get_nodes_collection()
    result = col.get(where={"type": name}, include=["metadatas"])

    migrated = 0
    for nid, meta in zip(result["ids"], result["metadatas"]):
        if int(meta.get("type_version", 1)) < body.new_version:
            new_meta = dict(meta)
            new_meta["type_version"] = body.new_version
            if body.defaults:
                try:
                    props = json.loads(new_meta.get("properties", "{}"))
                    props.update(body.defaults)
                    new_meta["properties"] = json.dumps(props)
                except Exception:
                    pass
            col.update(ids=[nid], metadatas=[new_meta])
            migrated += 1

    return {"migrated": migrated}


@router.get("/{name}/history")
def get_type_history(name: str):
    col = get_nodes_collection()
    result = col.get(where={"type": "SCHEMA_VERSION"}, include=["metadatas"])
    history = []
    for meta in result["metadatas"]:
        try:
            props = json.loads(meta.get("properties", "{}"))
        except Exception:
            props = {}
        if props.get("type_name") == name:
            history.append({
                "version": props.get("version"),
                "changes": props.get("changes", ""),
                "label": meta.get("label", ""),
                "created_at": meta.get("created_at"),
            })
    return sorted(history, key=lambda x: x.get("version") or 0, reverse=True)


@router.delete("/{name}", status_code=204)
def delete_type(name: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM type_definitions WHERE name=?", (name,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Type '{name}' not found")
        if dict(row)["is_builtin"]:
            raise HTTPException(status_code=403, detail="Cannot delete built-in types")
        conn.execute("DELETE FROM type_definitions WHERE name=?", (name,))
