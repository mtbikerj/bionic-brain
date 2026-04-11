"""
Migration script: ChromaDB 0.6.x → 1.x

Reads node data directly from the old ChromaDB SQLite file (no chromadb import
required for export), then re-imports into the upgraded ChromaDB 1.x collection.

Usage:
    # Export first (works on broken chromadb 0.6.x — uses only sqlite3):
    python -m backend.db.migrate_chroma export

    # After upgrading chromadb in requirements.txt and reinstalling:
    python -m backend.db.migrate_chroma import
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict

from backend.config import DATA_DIR

_CHROMA_DIR = os.path.join(DATA_DIR, "chroma")
_SQLITE_PATH = os.path.join(_CHROMA_DIR, "chroma.sqlite3")
_EXPORT_PATH = os.path.join(DATA_DIR, "chroma_export.json")


def export_nodes():
    """Read all nodes from the old ChromaDB SQLite and write to JSON."""
    import sqlite3

    if not os.path.exists(_SQLITE_PATH):
        print(f"ERROR: {_SQLITE_PATH} not found.")
        sys.exit(1)

    conn = sqlite3.connect(_SQLITE_PATH)
    rows = conn.execute("""
        SELECT e.embedding_id,
               em.key,
               em.string_value,
               em.int_value,
               em.float_value,
               em.bool_value
        FROM embeddings e
        JOIN embedding_metadata em ON e.id = em.id
        ORDER BY e.embedding_id, em.key
    """).fetchall()
    conn.close()

    nodes: dict[str, dict] = defaultdict(dict)
    for eid, key, sv, iv, fv, bv in rows:
        if sv is not None:
            val = sv
        elif iv is not None:
            val = iv
        elif fv is not None:
            val = fv
        else:
            val = bv
        nodes[eid][key] = val

    export_data = []
    for node_id, meta in nodes.items():
        document = meta.pop("chroma:document", meta.get("label", ""))
        export_data.append({"id": node_id, "document": document, "metadata": meta})

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(_EXPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(export_data, f, indent=2)

    print(f"Exported {len(export_data)} nodes to {_EXPORT_PATH}")


def import_nodes():
    """Import nodes from the JSON export into ChromaDB 1.x."""
    if not os.path.exists(_EXPORT_PATH):
        print(f"ERROR: {_EXPORT_PATH} not found. Run export first.")
        sys.exit(1)

    import chromadb  # noqa: PLC0415 — intentional late import

    with open(_EXPORT_PATH, encoding="utf-8") as f:
        export_data = json.load(f)

    client = chromadb.PersistentClient(path=_CHROMA_DIR)
    # Delete and recreate so we start clean
    try:
        client.delete_collection("nodes")
    except Exception:
        pass
    collection = client.get_or_create_collection(
        name="nodes",
        metadata={"hnsw:space": "cosine"},
    )

    ids = [n["id"] for n in export_data]
    documents = [n["document"] for n in export_data]
    metadatas = [n["metadata"] for n in export_data]

    # ChromaDB has a batch limit; add in chunks of 100
    chunk = 100
    for start in range(0, len(ids), chunk):
        collection.add(
            ids=ids[start : start + chunk],
            documents=documents[start : start + chunk],
            metadatas=metadatas[start : start + chunk],
        )

    print(f"Imported {len(ids)} nodes into ChromaDB 1.x at {_CHROMA_DIR}")
    os.remove(_EXPORT_PATH)
    print(f"Removed {_EXPORT_PATH}")


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("export", "import"):
        print("Usage: python -m backend.db.migrate_chroma [export|import]")
        sys.exit(1)

    if sys.argv[1] == "export":
        export_nodes()
    else:
        import_nodes()
