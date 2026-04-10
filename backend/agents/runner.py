"""Agent execution orchestrator."""
import json
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from backend.agents.base import AgentContext, AgentResult, BaseAgent
from backend.agents.builtin import (
    SummarizerAgent, EmailDrafterAgent, MeetingProcessorAgent, NodeLinkerAgent
)
from backend.db.connection import get_nodes_collection, get_db
from backend.config import CLAUDE_CODE_ENABLED, CLAUDE_CODE_SKILLS_PATH

# ── Registry ─────────────────────────────────────────────────────────────────

_AGENTS: dict[str, BaseAgent] = {
    a.name: a for a in [
        SummarizerAgent(),
        EmailDrafterAgent(),
        MeetingProcessorAgent(),
        NodeLinkerAgent(),
    ]
}

BUILTIN_CATALOG = [
    {
        "name": "summarizer",
        "description": "Summarizes a node's content and its connections into a concise overview",
        "suitable_for": ["NOTE", "TASK", "INBOX_ITEM", "FILE", "URL"],
        "icon": "📝",
        "source": "builtin",
    },
    {
        "name": "email_drafter",
        "description": "Drafts a professional email based on the task and its connected context",
        "suitable_for": ["TASK", "NOTE"],
        "icon": "✉️",
        "source": "builtin",
    },
    {
        "name": "meeting_processor",
        "description": "Extracts action items, decisions, and key points from meeting notes",
        "suitable_for": ["NOTE"],
        "icon": "📋",
        "source": "builtin",
    },
    {
        "name": "node_linker",
        "description": "Suggests meaningful relationships between this node and others in the graph",
        "suitable_for": ["*"],
        "icon": "🔗",
        "source": "builtin",
    },
]

CATALOG = BUILTIN_CATALOG


def _load_custom_agents_from_db() -> list[dict]:
    """Load CUSTOM_AGENT nodes from ChromaDB and return as catalog entries."""
    try:
        col = get_nodes_collection()
        result = col.get(where={"type": "CUSTOM_AGENT"}, include=["metadatas"])
        agents = []
        for nid, meta in sorted(
            zip(result["ids"], result["metadatas"]),
            key=lambda x: x[1].get("created_at", 0),
        ):
            try:
                props = json.loads(meta.get("properties", "{}"))
            except Exception:
                props = {}
            agents.append({
                "name": props.get("name"),
                "label": meta.get("label"),
                "description": props.get("description", ""),
                "icon": props.get("icon", "🤖"),
                "suitable_for": props.get("suitable_for", ["*"]),
                "prompt_template": props.get("prompt_template", ""),
                "output_format": props.get("output_format", "text"),
                "source": "custom",
            })
        return agents
    except Exception:
        return []


def _make_prompt_agent(data: dict) -> BaseAgent:
    from backend.agents.user_defined.prompt_agent import PromptTemplateAgent
    return PromptTemplateAgent(
        name=data["name"],
        label=data.get("label", data["name"]),
        description=data.get("description", ""),
        suitable_for=data.get("suitable_for", ["*"]),
        prompt_template=data.get("prompt_template", ""),
        output_format=data.get("output_format", "text"),
        icon=data.get("icon", "🤖"),
    )


def register_custom_agent(data: dict) -> None:
    _AGENTS[data["name"]] = _make_prompt_agent(data)


def unregister_custom_agent(name: str) -> None:
    _AGENTS.pop(name, None)


def _load_all_custom_agents() -> None:
    for data in _load_custom_agents_from_db():
        register_custom_agent(data)


_load_all_custom_agents()


def _load_cc_skills() -> list[dict]:
    if not CLAUDE_CODE_ENABLED or not CLAUDE_CODE_SKILLS_PATH:
        return []
    skills_dir = Path(CLAUDE_CODE_SKILLS_PATH)
    if not skills_dir.is_dir():
        return []
    entries = []
    for md_file in sorted(skills_dir.glob("*.md")):
        stem = md_file.stem
        display_name = stem.replace("_", " ").replace("-", " ").title()
        description = display_name
        try:
            for line in md_file.read_text(encoding="utf-8").splitlines():
                line = line.strip().lstrip("#").strip()
                if line:
                    description = line
                    break
        except OSError:
            pass
        entries.append({
            "name": f"cc:{stem}",
            "label": display_name,
            "description": description,
            "suitable_for": ["*"],
            "icon": "⚡",
            "source": "claude_code",
            "_skill_path": str(md_file),
        })
    return entries


def get_catalog(node_type: Optional[str] = None) -> list[dict]:
    custom = _load_custom_agents_from_db()
    cc_skills = _load_cc_skills()
    all_agents = (
        BUILTIN_CATALOG
        + [
            {
                "name": a["name"],
                "description": a.get("description", ""),
                "suitable_for": a.get("suitable_for", ["*"]),
                "icon": a.get("icon", "🤖"),
                "label": a.get("label"),
                "source": "custom",
            }
            for a in custom
        ]
        + cc_skills
    )
    if not node_type:
        return all_agents
    return [a for a in all_agents if "*" in a["suitable_for"] or node_type in a["suitable_for"]]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> int:
    return int(time.time() * 1000)


def _meta_to_flat(node_id: str, meta: dict) -> dict:
    """Merge ChromaDB metadata + properties JSON into a flat node dict."""
    try:
        props = json.loads(meta.get("properties", "{}"))
    except Exception:
        props = {}
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
        **props,
    }


def _update_node_props(node_id: str, prop_updates: dict, meta_updates: dict | None = None) -> None:
    """Update a node's properties JSON (and optionally top-level metadata fields)."""
    col = get_nodes_collection()
    res = col.get(ids=[node_id], include=["metadatas"])
    if not res["ids"]:
        return
    meta = dict(res["metadatas"][0])
    try:
        props = json.loads(meta.get("properties", "{}"))
    except Exception:
        props = {}
    props.update(prop_updates)
    meta["properties"] = json.dumps(props)
    meta["updated_at"] = _now()
    if meta_updates:
        meta.update(meta_updates)
    col.update(ids=[node_id], metadatas=[meta])


# ── Context loading ───────────────────────────────────────────────────────────

def _load_context(node_id: str, run_id: str, extra: Optional[dict] = None) -> AgentContext:
    from backend.blob.store import read_body

    col = get_nodes_collection()
    res = col.get(ids=[node_id], include=["metadatas"])
    if not res["ids"]:
        raise ValueError(f"Node {node_id} not found")
    node = _meta_to_flat(node_id, res["metadatas"][0])

    # Get related nodes via SQLite edges
    _SKIP_TYPES = {"DAY", "MONTH", "YEAR"}
    with get_db() as conn:
        rows = conn.execute(
            "SELECT from_id, to_id, type FROM edges WHERE from_id=? OR to_id=? LIMIT 40",
            (node_id, node_id),
        ).fetchall()

    related_ids = list({
        (r["to_id"] if r["from_id"] == node_id else r["from_id"])
        for r in rows
    } - {node_id})

    related_edges = {
        (r["to_id"] if r["from_id"] == node_id else r["from_id"]): r["type"]
        for r in rows
    }

    related = []
    if related_ids:
        rel_res = col.get(ids=related_ids[:20], include=["metadatas"])
        for nid, meta in zip(rel_res["ids"], rel_res["metadatas"]):
            if meta.get("type") not in _SKIP_TYPES:
                related.append({
                    "node": _meta_to_flat(nid, meta),
                    "rel_type": related_edges.get(nid, "RELATED_TO"),
                })

    body: Optional[str] = None
    if node.get("has_body"):
        content = read_body(node_id)
        if content:
            body = content.get("text") or json.dumps(content) if isinstance(content, dict) else str(content)

    return AgentContext(
        node=node,
        body=body,
        related=related,
        run_id=run_id,
        extra=extra or {},
    )


# ── Run management ────────────────────────────────────────────────────────────

def _create_run_node(task_id: str, agent_name: str, token_estimate: int) -> str:
    run_id = str(uuid.uuid4())
    now = _now()
    label = agent_name

    col = get_nodes_collection()
    col.add(
        ids=[run_id],
        documents=[label],
        metadatas=[{
            "type": "AGENT_RUN", "type_version": 1, "label": label,
            "created_at": now, "updated_at": now, "created_by": "system",
            "has_body": 0, "is_inbox": 0, "labels": "[]",
            "properties": json.dumps({
                "agent_name": agent_name,
                "task_id": task_id,
                "status": "running",
                "token_cost_estimate": token_estimate,
                "tokens_used": 0,
                "started_at": now,
            }),
        }],
    )

    # HAS_AGENT_RUN edge: task → run
    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO edges (id, from_id, to_id, type, created_at, created_by, properties) "
            "VALUES (?, ?, ?, 'HAS_AGENT_RUN', ?, 'system', '{}')",
            (str(uuid.uuid4()), task_id, run_id, now),
        )

    # Update task status
    _update_node_props(task_id, {"status": "in_progress_agent"})

    return run_id


def _finish_run(run_id: str, task_id: str, result: AgentResult) -> None:
    now = _now()
    task_status_map = {
        "complete": "agent_complete",
        "needs_review": "needs_review",
        "needs_you": "needs_you",
        "failed": "failed",
    }
    task_status = task_status_map.get(result.status, "failed")

    _update_node_props(run_id, {
        "status": result.status,
        "output_summary": result.output_summary,
        "output_json": json.dumps(result.output_json),
        "tokens_used": result.tokens_used,
        "error_message": result.error_message or "",
        "question": result.question or "",
        "ended_at": now,
    })
    _update_node_props(task_id, {"status": task_status})


def _run_to_dict(run_id: str) -> dict:
    col = get_nodes_collection()
    res = col.get(ids=[run_id], include=["metadatas"])
    if not res["ids"]:
        return {}
    props = {}
    try:
        props = json.loads(res["metadatas"][0].get("properties", "{}"))
    except Exception:
        pass
    try:
        output_json = json.loads(props.get("output_json", "{}"))
    except Exception:
        output_json = {}
    return {
        "run_id": run_id,
        "task_id": props.get("task_id"),
        "agent_name": props.get("agent_name"),
        "status": props.get("status"),
        "output_summary": props.get("output_summary", ""),
        "output_json": output_json,
        "tokens_used": props.get("tokens_used", 0),
        "token_cost_estimate": props.get("token_cost_estimate", 0),
        "error_message": props.get("error_message", ""),
        "question": props.get("question", ""),
        "started_at": props.get("started_at"),
        "ended_at": props.get("ended_at"),
    }


# ── Public API ────────────────────────────────────────────────────────────────

def execute_agent(task_id: str, agent_name: str, user_reply: Optional[str] = None) -> dict:
    if agent_name.startswith("cc:") and CLAUDE_CODE_ENABLED:
        from backend.agents.user_defined.skill_agent import SkillFileAgent
        stem = agent_name[3:]
        skill_path = str(Path(CLAUDE_CODE_SKILLS_PATH) / f"{stem}.md")
        agent: BaseAgent = SkillFileAgent(
            skill_path=skill_path,
            name=agent_name,
            description=stem.replace("_", " ").title(),
        )
    else:
        agent = _AGENTS.get(agent_name)
        if not agent:
            raise ValueError(f"Unknown agent: {agent_name}")

    ctx = _load_context(task_id, run_id="preview", extra={"user_reply": user_reply} if user_reply else {})
    estimate = agent.estimate_tokens(ctx)

    run_id = _create_run_node(task_id, agent_name, estimate)
    ctx.run_id = run_id

    try:
        result = agent.run(ctx)
    except Exception as e:
        result = AgentResult(status="failed", error_message=str(e))

    _finish_run(run_id, task_id, result)
    return _run_to_dict(run_id)


def get_latest_run(task_id: str) -> Optional[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT to_id FROM edges WHERE from_id=? AND type='HAS_AGENT_RUN'",
            (task_id,),
        ).fetchall()

    if not rows:
        return None

    run_ids = [r[0] for r in rows]
    col = get_nodes_collection()
    res = col.get(ids=run_ids, include=["metadatas"])

    # Find the one with the latest started_at
    best_id = None
    best_started = -1
    for nid, meta in zip(res["ids"], res["metadatas"]):
        try:
            props = json.loads(meta.get("properties", "{}"))
            started = props.get("started_at", 0) or 0
        except Exception:
            started = 0
        if started > best_started:
            best_started = started
            best_id = nid

    return _run_to_dict(best_id) if best_id else None


def get_active_tasks() -> list[dict]:
    _ACTIVE_STATUSES = {"in_progress_agent", "needs_you", "needs_review", "agent_complete", "failed"}
    _SKIP_TYPES = {"DAY", "MONTH", "YEAR", "AGENT_RUN", "SCHEMA_VERSION", "SAVED_SEARCH"}

    col = get_nodes_collection()
    result = col.get(include=["metadatas"])

    tasks = []
    for nid, meta in zip(result["ids"], result["metadatas"]):
        if meta.get("type") in _SKIP_TYPES:
            continue
        try:
            props = json.loads(meta.get("properties", "{}"))
        except Exception:
            props = {}
        if props.get("status") in _ACTIVE_STATUSES:
            tasks.append({
                "id": nid,
                "type": meta.get("type"),
                "label": meta.get("label"),
                "status": props.get("status"),
                "updated_at": meta.get("updated_at"),
            })

    return sorted(tasks, key=lambda x: x.get("updated_at") or 0, reverse=True)[:50]


def analyze_routing(task_id: str) -> dict:
    from backend.config import ANTHROPIC_API_KEY, AI_MODEL
    import anthropic

    ctx = _load_context(task_id, run_id="analysis")
    n = ctx.node

    # Check routing rules first
    col = get_nodes_collection()
    rules_res = col.get(where={"type": "ROUTING_RULE"}, include=["metadatas"])
    for nid, meta in sorted(
        zip(rules_res["ids"], rules_res["metadatas"]),
        key=lambda x: x[1].get("created_at", 0),
        reverse=True,
    ):
        try:
            rule = json.loads(meta.get("properties", "{}"))
        except Exception:
            rule = {}
        pattern = rule.get("pattern_description", "").lower()
        task_label = n.get("label", "").lower()
        task_type = n.get("type", "")
        if (rule.get("task_type") and rule["task_type"] == task_type) or \
           any(kw.strip() in task_label for kw in pattern.split(",") if kw.strip()):
            agent = rule.get("executor", "")
            if agent in _AGENTS:
                return {
                    "agent": agent,
                    "confidence": 1.0,
                    "reason": f"Matched routing rule: {rule.get('pattern_description', '')}",
                    "from_rule": True,
                    "rule_id": nid,
                }

    # Ask Claude
    catalog_desc = "\n".join(f"- {a['name']}: {a['description']}" for a in CATALOG)
    body_hint = f"\nBody content preview: {ctx.body[:200]}" if ctx.body else ""
    related_hint = (
        f"\nConnected nodes: {', '.join(r['node'].get('label','?') for r in ctx.related[:5])}"
        if ctx.related else ""
    )

    prompt = (
        f"Task: {n.get('label', '?')} (type: {n.get('type', '?')}){body_hint}{related_hint}\n\n"
        f"Available agents:\n{catalog_desc}\n\n"
        "Which agent is most appropriate? If none are suitable, say so.\n"
        'Respond with JSON: {"agent": "name_or_null", "confidence": 0.0-1.0, "reason": "one sentence"}'
    )

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model=AI_MODEL,
            max_tokens=200,
            system="You are a task routing assistant. Respond with valid JSON only, no markdown.",
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        if "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
            if text.startswith("json"):
                text = text[4:].strip()
        data = json.loads(text)
        return {
            "agent": data.get("agent"),
            "confidence": float(data.get("confidence", 0)),
            "reason": data.get("reason", ""),
            "from_rule": False,
        }
    except Exception as e:
        return {"agent": None, "confidence": 0, "reason": str(e), "from_rule": False}
