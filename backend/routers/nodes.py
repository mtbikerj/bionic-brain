import json
import time
import uuid
from fastapi import APIRouter, HTTPException
from backend.db.connection import get_nodes_collection, get_db
from backend.models.node import NodeCreate, NodeUpdate, NodeResponse
from backend.blob.store import read_body, write_body, delete_body

router = APIRouter(prefix="/nodes", tags=["nodes"])

_BASE_META = {"id", "type", "type_version", "label", "created_at", "updated_at",
              "created_by", "has_body", "is_inbox", "labels", "properties"}


def _now() -> int:
    return int(time.time() * 1000)


def _meta_to_node(node_id: str, metadata: dict) -> NodeResponse:
    try:
        labels = json.loads(metadata.get("labels", "[]"))
    except Exception:
        labels = []
    try:
        props = json.loads(metadata.get("properties", "{}"))
    except Exception:
        props = {}
    return NodeResponse(
        id=node_id,
        type=metadata.get("type", ""),
        type_version=int(metadata.get("type_version", 1)),
        label=metadata.get("label", ""),
        created_at=metadata.get("created_at"),
        updated_at=metadata.get("updated_at"),
        created_by=metadata.get("created_by", "user"),
        has_body=bool(metadata.get("has_body", 0)),
        is_inbox=bool(metadata.get("is_inbox", 0)),
        properties=props,
        labels=labels,
    )


def _build_meta(node_id: str, data: dict) -> tuple[str, str, dict]:
    """Returns (id, document, metadata) for ChromaDB upsert/add."""
    labels = data.get("labels", [])
    labels_str = json.dumps(labels) if isinstance(labels, list) else (labels or "[]")

    props = data.get("properties", {})
    props_str = json.dumps(props) if isinstance(props, dict) else (props or "{}")

    # Merge any extra scalar fields into properties
    extra = {k: v for k, v in data.items() if k not in _BASE_META and k != "id"}
    if extra:
        try:
            existing = json.loads(props_str)
        except Exception:
            existing = {}
        existing.update(extra)
        props_str = json.dumps(existing)

    metadata = {
        "type": str(data.get("type", "")),
        "type_version": int(data.get("type_version", 1)),
        "label": str(data.get("label", "")),
        "created_at": int(data.get("created_at", 0)),
        "updated_at": int(data.get("updated_at", 0)),
        "created_by": str(data.get("created_by", "user")),
        "has_body": int(bool(data.get("has_body", False))),
        "is_inbox": int(bool(data.get("is_inbox", False))),
        "labels": labels_str,
        "properties": props_str,
    }
    return node_id, str(data.get("label", node_id)), metadata


@router.post("", response_model=NodeResponse, status_code=201)
def create_node(body: NodeCreate):
    node_id = str(uuid.uuid4())
    now = _now()

    _ensure_today_nodes()

    with get_db() as conn:
        row = conn.execute(
            "SELECT version FROM type_definitions WHERE name=?", (body.type,)
        ).fetchone()
    current_version = int(row["version"]) if row else 1

    data = {
        "type": body.type,
        "type_version": current_version,
        "label": body.label,
        "labels": body.labels,
        "created_at": now,
        "updated_at": now,
        "created_by": "user",
        "has_body": False,
        "is_inbox": body.is_inbox,
        "properties": body.properties,
    }
    _, doc, meta = _build_meta(node_id, data)

    col = get_nodes_collection()
    col.add(ids=[node_id], documents=[doc], metadatas=[meta])

    _link_to_today(node_id, now)

    return _meta_to_node(node_id, meta)


@router.get("", response_model=list[NodeResponse])
def list_nodes(type: str | None = None, is_inbox: bool | None = None, limit: int = 100, offset: int = 0):
    col = get_nodes_collection()

    where_parts = []
    if type:
        where_parts.append({"type": type})
    if is_inbox is not None:
        where_parts.append({"is_inbox": int(is_inbox)})

    kwargs: dict = {"include": ["metadatas"]}
    if len(where_parts) > 1:
        kwargs["where"] = {"$and": where_parts}
    elif where_parts:
        kwargs["where"] = where_parts[0]

    result = col.get(**kwargs)
    pairs = sorted(
        zip(result["ids"], result["metadatas"]),
        key=lambda x: x[1].get("created_at", 0),
        reverse=True,
    )
    pairs = list(pairs)[offset: offset + limit]
    return [_meta_to_node(nid, meta) for nid, meta in pairs]


@router.get("/labels")
def list_labels():
    col = get_nodes_collection()
    result = col.get(include=["metadatas"])
    counts: dict[str, int] = {}
    for meta in result["metadatas"]:
        try:
            for lbl in json.loads(meta.get("labels", "[]")):
                if lbl:
                    counts[lbl] = counts.get(lbl, 0) + 1
        except Exception:
            pass
    return [{"label": l, "count": c} for l, c in sorted(counts.items(), key=lambda x: (-x[1], x[0]))]


@router.get("/{node_id}", response_model=NodeResponse)
def get_node(node_id: str):
    col = get_nodes_collection()
    result = col.get(ids=[node_id], include=["metadatas"])
    if not result["ids"]:
        raise HTTPException(status_code=404, detail="Node not found")
    return _meta_to_node(result["ids"][0], result["metadatas"][0])


@router.patch("/{node_id}", response_model=NodeResponse)
def update_node(node_id: str, body: NodeUpdate):
    col = get_nodes_collection()
    result = col.get(ids=[node_id], include=["metadatas"])
    if not result["ids"]:
        raise HTTPException(status_code=404, detail="Node not found")

    meta = dict(result["metadatas"][0])
    meta["updated_at"] = _now()

    if body.label is not None:
        meta["label"] = body.label
    if body.type is not None:
        meta["type"] = body.type.upper()
        meta["type_version"] = 1
    if body.type_version is not None and body.type is None:
        meta["type_version"] = body.type_version
    if body.labels is not None:
        meta["labels"] = json.dumps(body.labels)
    if body.properties:
        try:
            existing = json.loads(meta.get("properties", "{}"))
        except Exception:
            existing = {}
        existing.update(body.properties)
        meta["properties"] = json.dumps(existing)

    col.update(ids=[node_id], documents=[meta["label"]], metadatas=[meta])
    return _meta_to_node(node_id, meta)


@router.delete("/{node_id}", status_code=204)
def delete_node(node_id: str):
    col = get_nodes_collection()
    result = col.get(ids=[node_id], include=[])
    if not result["ids"]:
        raise HTTPException(status_code=404, detail="Node not found")
    col.delete(ids=[node_id])
    with get_db() as conn:
        conn.execute("DELETE FROM edges WHERE from_id=? OR to_id=?", (node_id, node_id))
    delete_body(node_id)


# ── Body endpoints ────────────────────────────────────────────────────────────

@router.get("/{node_id}/body")
def get_body(node_id: str):
    body = read_body(node_id)
    if body is None:
        return {"content": None}
    return {"content": body}


@router.put("/{node_id}/body", status_code=200)
def set_body(node_id: str, payload: dict):
    content = payload.get("content")
    if content is None:
        raise HTTPException(status_code=400, detail="Missing 'content' field")
    write_body(node_id, content)

    col = get_nodes_collection()
    result = col.get(ids=[node_id], include=["metadatas"])
    if result["ids"]:
        meta = dict(result["metadatas"][0])
        meta["has_body"] = 1
        meta["updated_at"] = _now()
        col.update(ids=[node_id], metadatas=[meta])
    return {"ok": True}


# ── Relationship endpoints ────────────────────────────────────────────────────

@router.get("/{node_id}/relationships")
def get_relationships(node_id: str):
    with get_db() as conn:
        out_rows = conn.execute(
            "SELECT id, to_id, type, created_at FROM edges WHERE from_id=?", (node_id,)
        ).fetchall()
        inc_rows = conn.execute(
            "SELECT id, from_id, type, created_at FROM edges WHERE to_id=?", (node_id,)
        ).fetchall()

    col = get_nodes_collection()
    related_ids = list({r["to_id"] for r in out_rows} | {r["from_id"] for r in inc_rows})
    node_map: dict[str, dict] = {}
    if related_ids:
        res = col.get(ids=related_ids, include=["metadatas"])
        for nid, meta in zip(res["ids"], res["metadatas"]):
            node_map[nid] = meta

    # Get current node's type for inverse lookup
    cur_res = col.get(ids=[node_id], include=["metadatas"])
    cur_type = cur_res["metadatas"][0].get("type", "") if cur_res["ids"] else ""

    # Build inverse label map and discover edge types pointing to this node's type
    source_types = {node_map.get(r["from_id"], {}).get("type", "") for r in inc_rows}
    inverse_label_map: dict[tuple, str] = {}  # (source_type, edge_name) -> inverse_label
    inverse_edge_types: list[dict] = []  # edge types from other types that target cur_type

    with get_db() as conn:
        all_type_rows = conn.execute(
            "SELECT name, edge_types FROM type_definitions"
        ).fetchall()

    for row in all_type_rows:
        try:
            ets = json.loads(row["edge_types"] or "[]")
        except Exception:
            ets = []
        for et in ets:
            # Map inverse labels for incoming edges
            if et.get("inverse") and row["name"] in source_types:
                inverse_label_map[(row["name"], et["name"])] = et["inverse"]
            # Find edge types that target this node's type (for add buttons)
            if cur_type and et.get("target_type") == cur_type and et.get("inverse"):
                inverse_edge_types.append({
                    "source_type": row["name"],
                    "edge_name": et["name"],
                    "inverse_label": et["inverse"],
                })

    outgoing = [
        {
            "rel_type": r["type"], "rel_id": r["id"], "created_at": r["created_at"],
            "target_id": r["to_id"],
            "target_label": node_map.get(r["to_id"], {}).get("label", "?"),
            "target_type": node_map.get(r["to_id"], {}).get("type", "?"),
        }
        for r in out_rows
    ]
    incoming = [
        {
            "rel_type": r["type"],
            "rel_label": inverse_label_map.get(
                (node_map.get(r["from_id"], {}).get("type", ""), r["type"]),
                r["type"]
            ),
            "rel_id": r["id"], "created_at": r["created_at"],
            "source_id": r["from_id"],
            "source_label": node_map.get(r["from_id"], {}).get("label", "?"),
            "source_type": node_map.get(r["from_id"], {}).get("type", "?"),
        }
        for r in inc_rows
    ]
    return {"outgoing": outgoing, "incoming": incoming, "inverse_edge_types": inverse_edge_types}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ensure_today_nodes():
    from datetime import date
    today = date.today()
    now = _now()
    year = today.year
    month = today.month
    day_str = today.isoformat()
    month_label = today.strftime("%B %Y")
    try:
        day_label = today.strftime("%A, %B %-d, %Y")
    except ValueError:
        day_label = today.strftime("%A, %B %d, %Y").replace(" 0", " ")

    year_id = f"year-{year}"
    month_id = f"month-{year}-{month}"
    day_id = f"day-{day_str}"

    col = get_nodes_collection()
    col.upsert(
        ids=[year_id],
        documents=[str(year)],
        metadatas=[{
            "type": "YEAR", "type_version": 1, "label": str(year),
            "created_at": now, "updated_at": now, "created_by": "system",
            "has_body": 0, "is_inbox": 0, "labels": "[]",
            "properties": json.dumps({"year": year}),
        }],
    )
    col.upsert(
        ids=[month_id],
        documents=[month_label],
        metadatas=[{
            "type": "MONTH", "type_version": 1, "label": month_label,
            "created_at": now, "updated_at": now, "created_by": "system",
            "has_body": 0, "is_inbox": 0, "labels": "[]",
            "properties": json.dumps({"year": year, "month": month}),
        }],
    )
    col.upsert(
        ids=[day_id],
        documents=[day_label],
        metadatas=[{
            "type": "DAY", "type_version": 1, "label": day_label,
            "created_at": now, "updated_at": now, "created_by": "system",
            "has_body": 0, "is_inbox": 0, "labels": "[]",
            "properties": json.dumps({"date": day_str}),
        }],
    )

    with get_db() as conn:
        _upsert_edge_sql(conn, f"{month_id}-BELONGS_TO-{year_id}", month_id, year_id, "BELONGS_TO", now)
        _upsert_edge_sql(conn, f"{day_id}-BELONGS_TO-{month_id}", day_id, month_id, "BELONGS_TO", now)


def _upsert_edge_sql(conn, edge_id: str, from_id: str, to_id: str, edge_type: str, now: int):
    conn.execute(
        "INSERT OR IGNORE INTO edges (id, from_id, to_id, type, created_at, created_by, properties) "
        "VALUES (?, ?, ?, ?, ?, 'system', '{}')",
        (edge_id, from_id, to_id, edge_type, now),
    )


def _link_to_today(node_id: str, now: int):
    from datetime import date
    today = date.today().isoformat()
    day_id = f"day-{today}"
    edge_id = f"{node_id}-LINKED_TO-{day_id}"
    with get_db() as conn:
        _upsert_edge_sql(conn, edge_id, node_id, day_id, "LINKED_TO", now)
