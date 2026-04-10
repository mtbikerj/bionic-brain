"""Backup and restore endpoints — export/import a ZIP of all graph data and blobs."""
import io
import json
import os
import time
import uuid
import zipfile

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from backend.db.connection import get_nodes_collection, get_db
from backend.blob.store import write_body
from backend.config import BLOB_DIR

router = APIRouter(prefix="/backup", tags=["backup"])

TEMPORAL_TYPES = {"YEAR", "MONTH", "DAY", "DATETIME"}
_BASE_META = {"type", "type_version", "label", "created_at", "updated_at",
              "created_by", "has_body", "is_inbox", "labels", "properties"}


def _meta_to_flat(node_id: str, meta: dict) -> dict:
    """Reconstruct a flat node dict from ChromaDB metadata for backup export."""
    try:
        props = json.loads(meta.get("properties", "{}"))
    except Exception:
        props = {}
    try:
        labels = json.loads(meta.get("labels", "[]"))
    except Exception:
        labels = []
    return {
        "id": node_id,
        "type": meta.get("type"),
        "type_version": meta.get("type_version", 1),
        "label": meta.get("label"),
        "created_at": meta.get("created_at"),
        "updated_at": meta.get("updated_at"),
        "created_by": meta.get("created_by"),
        "has_body": bool(meta.get("has_body", 0)),
        "is_inbox": bool(meta.get("is_inbox", 0)),
        "labels": labels,
        **props,
    }


def _flat_to_chroma(node: dict) -> tuple[str, str, dict]:
    """Convert a flat backup node dict to (id, document, metadata) for ChromaDB."""
    node_id = str(node["id"])
    extra = {k: v for k, v in node.items() if k not in _BASE_META and k != "id"}
    labels = node.get("labels", [])
    labels_str = json.dumps(labels) if isinstance(labels, list) else (labels or "[]")

    metadata = {
        "type": str(node.get("type", "")),
        "type_version": int(node.get("type_version", 1)),
        "label": str(node.get("label", "")),
        "created_at": int(node.get("created_at") or 0),
        "updated_at": int(node.get("updated_at") or 0),
        "created_by": str(node.get("created_by", "user")),
        "has_body": int(bool(node.get("has_body", False))),
        "is_inbox": int(bool(node.get("is_inbox", False))),
        "labels": labels_str,
        "properties": json.dumps(extra),
    }
    return node_id, str(node.get("label", node_id)), metadata


# ── Export ────────────────────────────────────────────────────────────────────

@router.get("/export")
def export_backup():
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        col = get_nodes_collection()

        # Nodes (excluding temporal)
        result = col.get(include=["metadatas"])
        nodes = [
            _meta_to_flat(nid, meta)
            for nid, meta in zip(result["ids"], result["metadatas"])
            if meta.get("type") not in TEMPORAL_TYPES
        ]
        zf.writestr("nodes.json", json.dumps(nodes, ensure_ascii=False, indent=2))

        # Edges
        with get_db() as conn:
            edge_rows = conn.execute("SELECT * FROM edges").fetchall()

        edges = []
        for row in edge_rows:
            try:
                props = json.loads(row["properties"] or "{}")
            except Exception:
                props = {}
            edges.append({
                "source_id": row["from_id"],
                "target_id": row["to_id"],
                "rel_type": row["type"],
                "role": props.get("role"),
                "weight": props.get("weight"),
                "note": props.get("note"),
            })
        zf.writestr("edges.json", json.dumps(edges, ensure_ascii=False, indent=2))

        # Type definitions
        with get_db() as conn:
            type_rows = conn.execute("SELECT * FROM type_definitions").fetchall()
        type_defs = [dict(r) for r in type_rows]
        zf.writestr("types.json", json.dumps(type_defs, ensure_ascii=False, indent=2))

        # Blob files
        if os.path.exists(BLOB_DIR):
            for root, _dirs, files in os.walk(BLOB_DIR):
                for fname in files:
                    if not fname.endswith(".json"):
                        continue
                    full = os.path.join(root, fname)
                    rel = os.path.relpath(full, BLOB_DIR)
                    zf.write(full, f"blobs/{rel}")

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=bionic-brain-backup.zip"},
    )


# ── Import ────────────────────────────────────────────────────────────────────

@router.post("/import")
async def import_backup(file: UploadFile = File(...)):
    data = await file.read()

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid ZIP.")

    names = zf.namelist()
    if "nodes.json" not in names:
        raise HTTPException(status_code=400, detail="Invalid backup: missing nodes.json.")

    nodes = json.loads(zf.read("nodes.json"))
    edges = json.loads(zf.read("edges.json")) if "edges.json" in names else []
    type_defs = json.loads(zf.read("types.json")) if "types.json" in names else []

    now = int(time.time() * 1000)
    nodes_imported = 0
    edges_imported = 0

    # Restore type definitions (non-builtin only)
    with get_db() as conn:
        for td in type_defs:
            if td.get("is_builtin"):
                continue
            conn.execute(
                """
                INSERT OR REPLACE INTO type_definitions
                    (name, is_builtin, fields, edge_types, color, icon, version, extends, created_at)
                VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    td["name"],
                    td.get("fields", "[]"),
                    td.get("edge_types", "[]"),
                    td.get("color", "#6b7280"),
                    td.get("icon", "node"),
                    td.get("version", 1),
                    td.get("extends"),
                    td.get("created_at", now),
                ),
            )

    # Restore nodes
    col = get_nodes_collection()
    for node in nodes:
        if node.get("type") in TEMPORAL_TYPES:
            continue
        nid, doc, meta = _flat_to_chroma(node)
        col.upsert(ids=[nid], documents=[doc], metadatas=[meta])
        nodes_imported += 1

    # Restore edges
    with get_db() as conn:
        for edge in edges:
            src = edge.get("source_id")
            tgt = edge.get("target_id")
            rel = edge.get("rel_type", "RELATED_TO")
            if not src or not tgt:
                continue
            props = {}
            if edge.get("role"):
                props["role"] = edge["role"]
            if edge.get("weight") is not None:
                props["weight"] = edge["weight"]
            if edge.get("note"):
                props["note"] = edge["note"]
            edge_id = str(uuid.uuid4())
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO edges (id, from_id, to_id, type, created_at, created_by, properties) "
                    "VALUES (?, ?, ?, ?, ?, 'system', ?)",
                    (edge_id, src, tgt, rel, now, json.dumps(props)),
                )
                edges_imported += 1
            except Exception:
                pass

    # Restore blob files
    blob_entries = [n for n in names if n.startswith("blobs/") and n.endswith(".json")]
    for entry in blob_entries:
        rel = entry[len("blobs/"):]
        dest = os.path.join(BLOB_DIR, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(zf.read(entry))

    return {
        "ok": True,
        "nodes_imported": nodes_imported,
        "edges_imported": edges_imported,
        "blobs_imported": len(blob_entries),
    }
