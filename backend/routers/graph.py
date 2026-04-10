import json
from fastapi import APIRouter, HTTPException
from backend.db.connection import get_db, get_nodes_collection

router = APIRouter(prefix="/graph", tags=["graph"])

_EXCLUDED = {"DAY", "MONTH", "YEAR", "SCHEMA_VERSION", "SAVED_SEARCH"}
_SKIP_EDGE_TYPES = {"LINKED_TO", "BELONGS_TO", "HAS_AGENT_RUN"}


def _node_dict(node_id: str, metadata: dict) -> dict:
    try:
        props = json.loads(metadata.get("properties", "{}"))
    except Exception:
        props = {}
    return {
        "id": node_id,
        "label": metadata.get("label", "?"),
        "type": metadata.get("type", "?"),
        "has_body": bool(metadata.get("has_body", 0)),
        "status": props.get("status"),
    }


@router.get("")
def get_graph(
    node_id: str | None = None,
    depth: int = 2,
    limit: int = 200,
    types: str | None = None,
):
    depth = max(1, min(depth, 5))
    limit = max(1, min(limit, 200))
    type_list = [t.strip() for t in types.split(",")] if types else None

    col = get_nodes_collection()

    if node_id:
        focal_res = col.get(ids=[node_id], include=["metadatas"])
        if not focal_res["ids"]:
            raise HTTPException(status_code=404, detail="Node not found")

        # BFS over SQLite edges
        visited = {node_id}
        frontier = {node_id}

        with get_db() as conn:
            for _ in range(depth):
                if not frontier:
                    break
                placeholders = ",".join("?" * len(frontier))
                rows = conn.execute(
                    f"SELECT to_id FROM edges WHERE from_id IN ({placeholders}) "
                    f"UNION SELECT from_id FROM edges WHERE to_id IN ({placeholders})",
                    list(frontier) + list(frontier),
                ).fetchall()
                new_ids = {r[0] for r in rows} - visited
                visited |= new_ids
                frontier = new_ids

        # Fetch all visited nodes from ChromaDB
        visited_list = list(visited)
        res = col.get(ids=visited_list, include=["metadatas"])
        pairs = [
            (nid, meta) for nid, meta in zip(res["ids"], res["metadatas"])
            if meta.get("type") not in _EXCLUDED
        ]
    else:
        # Global sample — most recently updated non-excluded nodes
        result = col.get(where={"type": {"$nin": list(_EXCLUDED)}}, include=["metadatas"])
        pairs = sorted(
            zip(result["ids"], result["metadatas"]),
            key=lambda x: x[1].get("updated_at", 0),
            reverse=True,
        )[:limit]
        pairs = list(pairs)

    if type_list:
        pairs = [(nid, meta) for nid, meta in pairs if meta.get("type") in type_list]

    pairs = pairs[:limit]
    truncated = len(pairs) >= limit

    if not pairs:
        return {"nodes": [], "edges": [], "focal_id": node_id, "total_nodes": 0, "truncated": False}

    # ── Load relationship fields per type ────────────────────────
    with get_db() as conn:
        type_rows = conn.execute("SELECT name, fields FROM type_definitions").fetchall()
    rel_fields_by_type: dict[str, list[str]] = {}
    for row in type_rows:
        try:
            fields = json.loads(row["fields"] or "[]")
            names = [f["name"] for f in fields if f.get("type") == "relationship"]
            if names:
                rel_fields_by_type[row["name"]] = names
        except Exception:
            pass

    # ── Pull in any property-referenced nodes not already in the set ──
    meta_by_id: dict[str, dict] = {nid: meta for nid, meta in pairs}
    extra_ids: list[str] = []
    for nid, meta in list(pairs):
        node_type = meta.get("type", "")
        field_names = rel_fields_by_type.get(node_type, [])
        if not field_names:
            continue
        try:
            props = json.loads(meta.get("properties", "{}"))
        except Exception:
            props = {}
        for field_name in field_names:
            target_id = props.get(field_name)
            if target_id and isinstance(target_id, str) and target_id not in meta_by_id:
                extra_ids.append(target_id)
                meta_by_id[target_id] = {}  # placeholder to avoid duplicates

    if extra_ids:
        extra_res = col.get(ids=extra_ids, include=["metadatas"])
        for eid, emeta in zip(extra_res["ids"], extra_res["metadatas"]):
            if emeta and emeta.get("type") not in _EXCLUDED:
                pairs.append((eid, emeta))
                meta_by_id[eid] = emeta

    all_node_ids = [nid for nid, _ in pairs]
    id_set = set(all_node_ids)

    # ── Explicit edges from SQLite ───────────────────────────────
    with get_db() as conn:
        placeholders = ",".join("?" * len(all_node_ids))
        edge_rows = conn.execute(
            f"SELECT id, from_id, to_id, type FROM edges "
            f"WHERE from_id IN ({placeholders}) AND to_id IN ({placeholders})",
            all_node_ids + all_node_ids,
        ).fetchall()

    edges = []
    conn_count: dict[str, int] = {}
    seen_edges: set[tuple] = set()
    for row in edge_rows:
        if row["type"] in _SKIP_EDGE_TYPES:
            continue
        if row["from_id"] in id_set and row["to_id"] in id_set:
            edges.append({"id": row["id"], "source": row["from_id"], "target": row["to_id"], "type": row["type"]})
            seen_edges.add((row["from_id"], row["to_id"], row["type"]))
            conn_count[row["from_id"]] = conn_count.get(row["from_id"], 0) + 1
            conn_count[row["to_id"]] = conn_count.get(row["to_id"], 0) + 1

    # ── Synthetic edges from relationship-type properties ────────
    for nid, meta in pairs:
        node_type = meta.get("type", "")
        field_names = rel_fields_by_type.get(node_type, [])
        if not field_names:
            continue
        try:
            props = json.loads(meta.get("properties", "{}"))
        except Exception:
            props = {}
        for field_name in field_names:
            target_id = props.get(field_name)
            if not target_id or not isinstance(target_id, str) or target_id not in id_set:
                continue
            edge_type = field_name.upper()
            key = (nid, target_id, edge_type)
            if key in seen_edges:
                continue
            seen_edges.add(key)
            edges.append({
                "id": f"prop-{nid}-{field_name}",
                "source": nid,
                "target": target_id,
                "type": edge_type,
            })
            conn_count[nid] = conn_count.get(nid, 0) + 1
            conn_count[target_id] = conn_count.get(target_id, 0) + 1

    nodes_out = []
    for nid, meta in pairs:
        if not meta:
            continue
        nd = _node_dict(nid, meta)
        nd["connection_count"] = conn_count.get(nid, 0)
        nodes_out.append(nd)

    return {
        "nodes": nodes_out,
        "edges": edges,
        "focal_id": node_id,
        "total_nodes": len(nodes_out),
        "truncated": truncated,
    }
