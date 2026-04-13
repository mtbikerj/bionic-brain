"""
DB layer: ChromaDB (nodes, semantic search) + SQLite (edges, type definitions).
"""
from __future__ import annotations

import logging
import os
import sqlite3
from contextlib import contextmanager

import chromadb

from backend.config import DATA_DIR

logger = logging.getLogger(__name__)

_CHROMA_DIR = os.path.join(DATA_DIR, "chroma")
_SQLITE_PATH = os.path.join(DATA_DIR, "graph.db")

_chroma_client: chromadb.PersistentClient | None = None
_nodes_collection: chromadb.Collection | None = None


def get_nodes_collection() -> chromadb.Collection:
    global _chroma_client, _nodes_collection
    if _nodes_collection is None:
        os.makedirs(_CHROMA_DIR, exist_ok=True)
        _chroma_client = chromadb.PersistentClient(path=_CHROMA_DIR)
        _nodes_collection = _chroma_client.get_or_create_collection(
            name="nodes",
            metadata={"hnsw:space": "cosine"},
        )
    return _nodes_collection


@contextmanager
def get_db():
    """SQLite connection with WAL mode and auto commit/rollback."""
    conn = sqlite3.connect(_SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Create SQLite tables and ChromaDB collection if they don't exist."""
    os.makedirs(DATA_DIR, exist_ok=True)
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS edges (
                id          TEXT PRIMARY KEY,
                from_id     TEXT NOT NULL,
                to_id       TEXT NOT NULL,
                type        TEXT NOT NULL,
                created_at  INTEGER NOT NULL,
                created_by  TEXT NOT NULL DEFAULT 'user',
                properties  TEXT NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
            CREATE INDEX IF NOT EXISTS idx_edges_to   ON edges(to_id);
            CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);

            CREATE TABLE IF NOT EXISTS type_definitions (
                name        TEXT PRIMARY KEY,
                is_builtin  INTEGER NOT NULL DEFAULT 0,
                fields      TEXT NOT NULL DEFAULT '[]',
                edge_types  TEXT NOT NULL DEFAULT '[]',
                color       TEXT NOT NULL DEFAULT '#6b7280',
                icon        TEXT NOT NULL DEFAULT 'node',
                version     INTEGER NOT NULL DEFAULT 1,
                extends     TEXT,
                created_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS edge_type_definitions (
                name        TEXT PRIMARY KEY,
                is_builtin  INTEGER NOT NULL DEFAULT 1,
                created_at  INTEGER NOT NULL
            );
        """)
    # Migration: add archive_when column to type_definitions if it doesn't exist yet
    with get_db() as conn:
        try:
            conn.execute("ALTER TABLE type_definitions ADD COLUMN archive_when TEXT")
        except sqlite3.OperationalError:
            pass  # column already exists

    # Migration: unique constraint on edges(from_id, to_id, type)
    with get_db() as conn:
        try:
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique "
                "ON edges(from_id, to_id, type)"
            )
        except sqlite3.OperationalError as e:
            logger.warning("Could not create unique edge index (duplicate rows may exist): %s", e)

    # Ensure ChromaDB collection exists
    get_nodes_collection()
