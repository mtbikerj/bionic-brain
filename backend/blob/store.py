import json
import os
from backend.config import BLOB_DIR


def _blob_path(node_id: str) -> str:
    prefix = node_id[:2]
    return os.path.join(BLOB_DIR, prefix, node_id, "body.json")


def read_body(node_id: str) -> dict | None:
    path = _blob_path(node_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_body(node_id: str, content: dict) -> None:
    path = _blob_path(node_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(content, f, ensure_ascii=False, indent=2)


def delete_body(node_id: str) -> None:
    path = _blob_path(node_id)
    if os.path.exists(path):
        os.remove(path)


def body_exists(node_id: str) -> bool:
    return os.path.exists(_blob_path(node_id))
