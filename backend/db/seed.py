"""
Idempotent seed script — initializes built-in node types and system constraints.
Run once on first launch; safe to re-run at any time.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.db.connection import get_db, init_db

BUILT_IN_TYPES = [
    # Temporal
    {
        "name": "YEAR",
        "is_builtin": True,
        "fields": [{"name": "year", "type": "number", "required": True}],
        "color": "#6366f1",
        "icon": "calendar",
    },
    {
        "name": "MONTH",
        "is_builtin": True,
        "fields": [
            {"name": "year", "type": "number", "required": True},
            {"name": "month", "type": "number", "required": True},
            {"name": "label", "type": "short_text", "required": True},
        ],
        "color": "#8b5cf6",
        "icon": "calendar",
    },
    {
        "name": "DAY",
        "is_builtin": True,
        "fields": [
            {"name": "date", "type": "date", "required": True},
            {"name": "label", "type": "short_text", "required": True},
        ],
        "color": "#a78bfa",
        "icon": "calendar",
    },
    {
        "name": "DATETIME",
        "is_builtin": True,
        "fields": [{"name": "timestamp", "type": "datetime", "required": True}],
        "color": "#c4b5fd",
        "icon": "clock",
    },
    # Core knowledge
    {
        "name": "PERSON",
        "is_builtin": True,
        "fields": [
            {"name": "name", "type": "short_text", "required": True},
            {"name": "email", "type": "short_text", "required": False},
            {"name": "phone", "type": "short_text", "required": False},
            {"name": "title", "type": "short_text", "required": False},
            {"name": "organization", "type": "short_text", "required": False},
        ],
        "color": "#f59e0b",
        "icon": "person",
    },
    {
        "name": "NOTE",
        "is_builtin": True,
        "fields": [
            {"name": "title", "type": "short_text", "required": True},
        ],
        "color": "#10b981",
        "icon": "note",
    },
    {
        "name": "TASK",
        "is_builtin": True,
        "fields": [
            {"name": "title", "type": "short_text", "required": True},
            {
                "name": "status",
                "type": "choice_single",
                "required": True,
                "options": [
                    "inbox", "in_progress", "in_progress_agent",
                    "needs_you", "needs_review", "agent_complete",
                    "done_silent", "blocked", "failed", "done",
                ],
                "default": "inbox",
            },
            {
                "name": "priority",
                "type": "choice_single",
                "required": False,
                "options": ["low", "medium", "high", "urgent"],
                "default": "medium",
            },
            {"name": "due_date", "type": "date", "required": False},
        ],
        "color": "#3b82f6",
        "icon": "task",
    },
    {
        "name": "FILE",
        "is_builtin": True,
        "fields": [
            {"name": "filename", "type": "short_text", "required": True},
            {"name": "mime_type", "type": "short_text", "required": False},
            {"name": "size_bytes", "type": "number", "required": False},
            {"name": "file_path", "type": "short_text", "required": True},
        ],
        "color": "#64748b",
        "icon": "file",
    },
    {
        "name": "URL",
        "is_builtin": True,
        "fields": [
            {"name": "href", "type": "short_text", "required": True},
            {"name": "title", "type": "short_text", "required": False},
            {"name": "description", "type": "long_text", "required": False},
            {"name": "snapshot_date", "type": "date", "required": False},
        ],
        "color": "#06b6d4",
        "icon": "url",
    },
    {
        "name": "LOCATION",
        "is_builtin": True,
        "fields": [
            {"name": "name", "type": "short_text", "required": True},
            {"name": "address", "type": "short_text", "required": False},
            {"name": "lat", "type": "number", "required": False},
            {"name": "lng", "type": "number", "required": False},
            {"name": "region", "type": "short_text", "required": False},
        ],
        "color": "#ef4444",
        "icon": "location",
    },
    # AI / System
    {
        "name": "ROUTING_RULE",
        "is_builtin": True,
        "fields": [
            {"name": "pattern_description", "type": "long_text", "required": True},
            {"name": "task_type", "type": "short_text", "required": False},
            {"name": "executor", "type": "choice_single", "required": True,
             "options": ["builtin", "claude_code", "user_defined"]},
            {"name": "mode", "type": "choice_single", "required": True,
             "options": ["suggest", "always"]},
            {"name": "hit_count", "type": "number", "required": False},
        ],
        "color": "#d97706",
        "icon": "rule",
    },
    {
        "name": "SCHEMA_VERSION",
        "is_builtin": True,
        "fields": [
            {"name": "type_name", "type": "short_text", "required": True},
            {"name": "version", "type": "number", "required": True},
            {"name": "changes", "type": "long_text", "required": False},
        ],
        "color": "#78716c",
        "icon": "schema",
    },
    {
        "name": "AGENT_RUN",
        "is_builtin": True,
        "fields": [
            {"name": "agent_name", "type": "short_text", "required": True},
            {"name": "task_id", "type": "short_text", "required": False},
            {"name": "started_at", "type": "datetime", "required": False},
            {"name": "ended_at", "type": "datetime", "required": False},
            {
                "name": "status",
                "type": "choice_single",
                "required": True,
                "options": ["running", "complete", "needs_review", "needs_you", "failed"],
                "default": "running",
            },
            {"name": "token_cost_estimate", "type": "number", "required": False},
            {"name": "tokens_used", "type": "number", "required": False},
            {"name": "output_summary", "type": "long_text", "required": False},
            {"name": "error_message", "type": "short_text", "required": False},
            {"name": "question", "type": "short_text", "required": False},
        ],
        "color": "#f97316",
        "icon": "agent",
    },
    {
        "name": "INBOX_ITEM",
        "is_builtin": True,
        "fields": [
            {"name": "raw_text", "type": "short_text", "required": True},
            {"name": "captured_at", "type": "datetime", "required": True},
        ],
        "color": "#94a3b8",
        "icon": "inbox",
    },
    {
        "name": "SAVED_SEARCH",
        "is_builtin": True,
        "fields": [
            {"name": "query", "type": "short_text", "required": True},
            {"name": "mode", "type": "choice_single", "required": True,
             "options": ["text", "nl"], "default": "text"},
            {"name": "cypher", "type": "long_text", "required": False},
            {"name": "filters", "type": "long_text", "required": False},
        ],
        "color": "#0ea5e9",
        "icon": "search",
    },
]

BUILT_IN_EDGE_TYPES = [
    "HAS_MEMBER", "CONTAINS", "PART_OF",
    "OWNED_BY", "ASSIGNED_TO", "CREATED_BY",
    "DEPENDS_ON", "BLOCKS", "TRIGGERS",
    "REFERENCES", "INFORMED_BY", "RELATED_TO",
    "LINKED_TO", "DUE_ON", "COMPLETED_ON", "PRECEDED_BY", "RESULTED_IN",
    "BELONGS_TO", "EXTENDS",
]


def seed():
    init_db()
    now = int(time.time() * 1000)

    with get_db() as conn:
        for t in BUILT_IN_TYPES:
            conn.execute(
                """
                INSERT OR IGNORE INTO type_definitions
                    (name, is_builtin, fields, edge_types, color, icon, version, created_at)
                VALUES (?, 1, ?, '[]', ?, ?, 1, ?)
                """,
                (t["name"], json.dumps(t["fields"]), t["color"], t["icon"], now),
            )
            # Update mutable fields on re-run
            conn.execute(
                "UPDATE type_definitions SET color=?, icon=?, fields=? WHERE name=? AND is_builtin=1",
                (t["color"], t["icon"], json.dumps(t["fields"]), t["name"]),
            )

        for et in BUILT_IN_EDGE_TYPES:
            conn.execute(
                "INSERT OR IGNORE INTO edge_type_definitions (name, is_builtin, created_at) VALUES (?, 1, ?)",
                (et, now),
            )

    print("Seed complete.")


if __name__ == "__main__":
    seed()
