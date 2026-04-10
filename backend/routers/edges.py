import json
import time
import uuid
from fastapi import APIRouter, HTTPException
from backend.db.connection import get_nodes_collection, get_db
from backend.models.edge import EdgeCreate, EdgeResponse

router = APIRouter(prefix="/edges", tags=["edges"])


def _now() -> int:
    return int(time.time() * 1000)


@router.post("", response_model=EdgeResponse, status_code=201)
def create_edge(body: EdgeCreate):
    edge_id = str(uuid.uuid4())
    now = _now()

    col = get_nodes_collection()
    if not col.get(ids=[body.from_id], include=[])["ids"]:
        raise HTTPException(status_code=404, detail=f"Source node {body.from_id} not found")
    if not col.get(ids=[body.to_id], include=[])["ids"]:
        raise HTTPException(status_code=404, detail=f"Target node {body.to_id} not found")

    edge_type = body.type.upper().replace(" ", "_").replace("-", "_")

    with get_db() as conn:
        conn.execute(
            "INSERT INTO edges (id, from_id, to_id, type, created_at, created_by, properties) "
            "VALUES (?, ?, ?, ?, ?, 'user', ?)",
            (edge_id, body.from_id, body.to_id, edge_type, now, json.dumps(body.properties)),
        )

    return EdgeResponse(
        id=edge_id,
        from_id=body.from_id,
        to_id=body.to_id,
        type=edge_type,
        created_at=now,
        created_by="user",
        properties=body.properties,
    )


@router.delete("/{edge_id}", status_code=204)
def delete_edge(edge_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM edges WHERE id=?", (edge_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Edge not found")
        conn.execute("DELETE FROM edges WHERE id=?", (edge_id,))
