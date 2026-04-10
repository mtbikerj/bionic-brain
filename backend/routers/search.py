import json
import time as time_mod
import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.db.connection import get_nodes_collection, get_db

router = APIRouter(prefix="/search", tags=["search"])

_TEMPORAL_TYPES = {"DAY", "MONTH", "YEAR"}


def _meta_to_dict(node_id: str, metadata: dict) -> dict:
    try:
        props = json.loads(metadata.get("properties", "{}"))
    except Exception:
        props = {}
    return {
        "id": node_id,
        "type": metadata.get("type"),
        "label": metadata.get("label"),
        "has_body": bool(metadata.get("has_body", 0)),
        "properties": props,
    }


@router.get("")
def search(
    q: str,
    type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 50,
):
    if not q.strip():
        return {"results": [], "query": q, "count": 0}

    col = get_nodes_collection()

    where_parts = []
    if type:
        where_parts.append({"type": type})
    else:
        where_parts.append({"type": {"$nin": list(_TEMPORAL_TYPES)}})

    if date_from:
        ts = int(datetime.fromisoformat(date_from).timestamp() * 1000)
        where_parts.append({"created_at": {"$gte": ts}})
    if date_to:
        ts = int(datetime.fromisoformat(date_to).timestamp() * 1000) + 86_400_000
        where_parts.append({"created_at": {"$lte": ts}})

    where = {"$and": where_parts} if len(where_parts) > 1 else where_parts[0]
    result = col.get(where=where, include=["metadatas"])

    q_lower = q.lower()
    matches = []
    for nid, meta in zip(result["ids"], result["metadatas"]):
        label = (meta.get("label") or "").lower()
        try:
            props = json.loads(meta.get("properties", "{}"))
            searchable = label + " " + " ".join(str(v) for v in props.values() if isinstance(v, str))
        except Exception:
            searchable = label
        if q_lower in searchable:
            matches.append((nid, meta, meta.get("updated_at", 0)))

    matches.sort(key=lambda x: x[2], reverse=True)
    matches = matches[:limit]

    return {
        "results": [_meta_to_dict(nid, meta) for nid, meta, _ in matches],
        "query": q,
        "count": len(matches),
    }


@router.get("/today")
def get_today_items():
    from datetime import date
    today = date.today().isoformat()
    day_id = f"day-{today}"

    col = get_nodes_collection()
    day_res = col.get(ids=[day_id], include=["metadatas"])
    day_meta = day_res["metadatas"][0] if day_res["ids"] else None

    with get_db() as conn:
        linked_ids = [r[0] for r in conn.execute(
            "SELECT from_id FROM edges WHERE to_id=? AND type='LINKED_TO'", (day_id,)
        ).fetchall()]
        due_ids = [r[0] for r in conn.execute(
            "SELECT from_id FROM edges WHERE to_id=? AND type='DUE_ON'", (day_id,)
        ).fetchall()]
        completed_ids = [r[0] for r in conn.execute(
            "SELECT from_id FROM edges WHERE to_id=? AND type='COMPLETED_ON'", (day_id,)
        ).fetchall()]

    def fetch_nodes(ids: list[str]) -> list[dict]:
        if not ids:
            return []
        res = col.get(ids=ids, include=["metadatas"])
        return [
            {"id": nid, "type": meta.get("type"), "label": meta.get("label")}
            for nid, meta in zip(res["ids"], res["metadatas"])
            if meta.get("type") not in _TEMPORAL_TYPES
        ]

    return {
        "day": {"id": day_id, "label": day_meta.get("label") if day_meta else today, "date": today} if day_meta else None,
        "created_today": fetch_nodes(linked_ids),
        "due_today": fetch_nodes(due_ids),
        "completed_today": fetch_nodes(completed_ids),
    }


# ── Natural language search (semantic via ChromaDB) ───────────────────────────

class NLSearchRequest(BaseModel):
    query: str


@router.post("/nl")
def nl_search(body: NLSearchRequest):
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    col = get_nodes_collection()

    try:
        results = col.query(
            query_texts=[body.query],
            where={"type": {"$nin": list(_TEMPORAL_TYPES)}},
            n_results=50,
            include=["metadatas", "distances"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    nodes = []
    if results["ids"] and results["ids"][0]:
        for nid, meta, dist in zip(
            results["ids"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            node = _meta_to_dict(nid, meta)
            node["similarity"] = round(float(1 - dist), 4)
            nodes.append(node)

    return {"results": nodes, "query": body.query, "count": len(nodes)}


# ── Saved searches ────────────────────────────────────────────────────────────

class SaveSearchRequest(BaseModel):
    label: str
    query: str
    mode: str
    cypher: str = ""
    filters: dict = {}


@router.get("/saved")
def list_saved_searches():
    col = get_nodes_collection()
    result = col.get(where={"type": "SAVED_SEARCH"}, include=["metadatas"])
    pairs = sorted(
        zip(result["ids"], result["metadatas"]),
        key=lambda x: x[1].get("created_at", 0),
        reverse=True,
    )[:50]
    out = []
    for nid, meta in pairs:
        try:
            props = json.loads(meta.get("properties", "{}"))
        except Exception:
            props = {}
        out.append({
            "id": nid,
            "label": meta.get("label"),
            "query": props.get("query", ""),
            "mode": props.get("mode", "text"),
            "cypher": props.get("cypher", ""),
            "filters": props.get("filters", {}),
            "created_at": meta.get("created_at"),
        })
    return out


@router.post("/saved", status_code=201)
def save_search(body: SaveSearchRequest):
    now = int(time_mod.time() * 1000)
    node_id = str(uuid.uuid4())
    col = get_nodes_collection()
    col.add(
        ids=[node_id],
        documents=[body.label],
        metadatas=[{
            "type": "SAVED_SEARCH", "type_version": 1, "label": body.label,
            "created_at": now, "updated_at": now, "created_by": "user",
            "has_body": 0, "is_inbox": 0, "labels": "[]",
            "properties": json.dumps({
                "query": body.query,
                "mode": body.mode,
                "cypher": body.cypher,
                "filters": body.filters,
            }),
        }],
    )
    return {"id": node_id, "label": body.label}


@router.delete("/saved/{search_id}", status_code=204)
def delete_saved_search(search_id: str):
    col = get_nodes_collection()
    result = col.get(ids=[search_id], include=["metadatas"])
    if not result["ids"] or result["metadatas"][0].get("type") != "SAVED_SEARCH":
        raise HTTPException(status_code=404, detail="Saved search not found")
    col.delete(ids=[search_id])
