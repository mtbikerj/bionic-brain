import json
import logging
import os
import subprocess
import time
import uuid
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import Optional
from backend.config import ANTHROPIC_API_KEY, AI_MODEL, AI_MAX_TOKENS_PER_REQUEST, CLAUDE_CODE_ENABLED

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])

# ── Type suggestion ───────────────────────────────────────────────────────────

SUGGEST_TYPE_SYSTEM = """You are a type definition assistant for a personal knowledge graph. Help users define custom node types by suggesting appropriate fields.

When the user describes a domain, system, or methodology (like PARA, GTD, coin collecting, book tracking, etc.), suggest ALL the types they'll need at once in a single response. Never say you'll suggest more types later — include everything upfront.

Always respond with valid JSON in this exact format:
{
  "message": "Your conversational response",
  "suggestions": [
    {
      "name": "TYPE_NAME_IN_CAPS_WITH_UNDERSCORES",
      "fields": [
        {
          "name": "field_name_snake_case",
          "type": "field_type",
          "required": true,
          "options": ["opt1", "opt2"]
        }
      ],
      "color": "#hexcolor",
      "edge_types": [
        {
          "name": "RELATIONSHIP_NAME",
          "inverse": "inverse_name",
          "target_type": "TARGET_TYPE_NAME"
        }
      ]
    }
  ]
}

Field types: short_text, long_text, number, currency, date, datetime, boolean, choice_single, choice_multi, relationship, file, url

Rules:
- Do NOT include a "title", "name", or "label" field — the node label is the name/title
- Suggest 4-8 fields most relevant to the domain per type
- Use currency for monetary values, boolean for yes/no, choice_single for fixed-option enums
- Only include "options" for choice_single and choice_multi fields
- Pick a distinct, thematically appropriate hex color for each type
- When a domain needs multiple types (e.g. PARA needs Project, Area, Resource, Archive), include ALL of them in the suggestions array
- edge_types is optional — only add when the type has natural relationships to other types
- When the user refines, return the updated full suggestions array
- Keep message brief and conversational"""


class Message(BaseModel):
    role: str
    content: str


class SuggestTypeRequest(BaseModel):
    conversation: list[Message]


class FieldSuggestion(BaseModel):
    name: str
    type: str
    required: bool = False
    options: Optional[list[str]] = None
    default: Optional[str] = None
    target_type: Optional[str] = None


class EdgeTypeSuggestion(BaseModel):
    name: str
    inverse: Optional[str] = None
    target_type: Optional[str] = None


class TypeSuggestion(BaseModel):
    name: str
    fields: list[FieldSuggestion]
    color: str
    edge_types: list[EdgeTypeSuggestion] = []


class SuggestTypeResponse(BaseModel):
    message: str
    suggestions: list[TypeSuggestion] = []


def _parse_suggestion(s: dict) -> TypeSuggestion:
    fields = [
        FieldSuggestion(
            name=f["name"],
            type=f["type"],
            required=f.get("required", False),
            options=f.get("options") if f["type"] in ("choice_single", "choice_multi") else None,
            default=f.get("default"),
            target_type=f.get("target_type"),
        )
        for f in s.get("fields", [])
    ]
    edge_types = [
        EdgeTypeSuggestion(
            name=e.get("name", "").upper().replace(" ", "_"),
            inverse=e.get("inverse") or None,
            target_type=(e.get("target_type") or "").upper().replace(" ", "_") or None,
        )
        for e in s.get("edge_types", [])
        if e.get("name")
    ]
    return TypeSuggestion(
        name=s["name"].upper().replace(" ", "_"),
        fields=fields,
        color=s.get("color", "#6b7280"),
        edge_types=edge_types,
    )


def _parse_suggest_response(text: str) -> SuggestTypeResponse:
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()

    data = json.loads(text)
    suggestions = []
    # Primary: "suggestions" array format
    if data.get("suggestions"):
        suggestions = [_parse_suggestion(s) for s in data["suggestions"]]
    # Fallback: old single "suggestion" format
    elif data.get("suggestion"):
        suggestions = [_parse_suggestion(data["suggestion"])]
    return SuggestTypeResponse(message=data.get("message", "Here's a suggestion."), suggestions=suggestions)


@router.post("/suggest-type", response_model=SuggestTypeResponse)
def suggest_type(body: SuggestTypeRequest):
    convo_text = "\n".join(
        f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}"
        for m in body.conversation
    )
    full_prompt = f"{SUGGEST_TYPE_SYSTEM}\n\n{convo_text}"

    if CLAUDE_CODE_ENABLED:
        try:
            env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
            result = subprocess.run(
                ["claude", "-p", full_prompt],
                capture_output=True, text=True, timeout=60,
                env=env,
            )
            if result.returncode != 0:
                stderr = result.stderr.strip()
                stdout = result.stdout.strip()
                err = stderr or stdout or f"exit code {result.returncode}"
                raise HTTPException(status_code=503, detail=f"Claude Code error: {err}")
            text = result.stdout.strip()
        except FileNotFoundError:
            raise HTTPException(status_code=503, detail="claude CLI not found.")
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=503, detail="Claude Code timed out.")
        try:
            return _parse_suggest_response(text)
        except (json.JSONDecodeError, KeyError):
            return SuggestTypeResponse(message=text or "Sorry, I couldn't generate a suggestion.")

    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not configured. Add it to your .env file, or enable Claude Code (CLAUDE_CODE_ENABLED=true).",
        )

    try:
        import anthropic
    except ImportError:
        raise HTTPException(status_code=503, detail="anthropic package not installed.")

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        messages = [{"role": m.role, "content": m.content} for m in body.conversation]
        response = client.messages.create(
            model=AI_MODEL,
            max_tokens=AI_MAX_TOKENS_PER_REQUEST,
            system=SUGGEST_TYPE_SYSTEM,
            messages=messages,
        )
        text = response.content[0].text.strip()
        try:
            return _parse_suggest_response(text)
        except (json.JSONDecodeError, KeyError):
            return SuggestTypeResponse(message=text or "Sorry, I couldn't generate a suggestion.")
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=503, detail="Anthropic API key is invalid.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Agent catalog ─────────────────────────────────────────────────────────────

@router.get("/agents")
def list_agents(node_type: Optional[str] = None):
    from backend.agents.runner import get_catalog
    return get_catalog(node_type)


# ── Routing analysis ──────────────────────────────────────────────────────────

class RouteTaskRequest(BaseModel):
    task_id: str


@router.post("/route-task")
def route_task(body: RouteTaskRequest):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured.")
    try:
        from backend.agents.runner import analyze_routing
        return analyze_routing(body.task_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Agent execution ───────────────────────────────────────────────────────────

class RunAgentRequest(BaseModel):
    task_id: str
    agent_name: str


@router.post("/run-agent", status_code=202)
def run_agent(body: RunAgentRequest, background_tasks: BackgroundTasks):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured.")
    try:
        from backend.agents.runner import start_agent, execute_agent_bg
        run_id = start_agent(body.task_id, body.agent_name)
        background_tasks.add_task(execute_agent_bg, body.task_id, body.agent_name, run_id)
        return {"run_id": run_id, "status": "running"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to start agent for task %s: %s", body.task_id, e)
        raise HTTPException(status_code=500, detail="Failed to start agent.")


class RespondRequest(BaseModel):
    reply: str


@router.post("/run-agent/{run_id}/respond", status_code=202)
def respond_to_agent(run_id: str, body: RespondRequest, background_tasks: BackgroundTasks):
    from backend.db.connection import get_nodes_collection
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured.")

    col = get_nodes_collection()
    res = col.get(ids=[run_id], include=["metadatas"])
    if not res["ids"] or res["metadatas"][0].get("type") != "AGENT_RUN":
        raise HTTPException(status_code=404, detail="Agent run not found")

    meta = res["metadatas"][0]
    try:
        props = json.loads(meta.get("properties", "{}"))
    except json.JSONDecodeError:
        logger.warning("Corrupt properties JSON for agent run %s", run_id)
        props = {}

    if props.get("status") != "needs_you":
        raise HTTPException(status_code=400, detail="Run is not in needs_you state")

    task_id = props.get("task_id", "")
    agent_name = props.get("agent_name", "")
    try:
        from backend.agents.runner import start_agent, execute_agent_bg
        new_run_id = start_agent(task_id, agent_name)
        background_tasks.add_task(execute_agent_bg, task_id, agent_name, new_run_id, body.reply)
        return {"run_id": new_run_id, "status": "running"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to start agent for task %s: %s", task_id, e)
        raise HTTPException(status_code=500, detail="Failed to start agent.")


@router.post("/run-agent/{run_id}/retry", status_code=202)
def retry_agent(run_id: str, background_tasks: BackgroundTasks):
    from backend.db.connection import get_nodes_collection
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured.")

    col = get_nodes_collection()
    res = col.get(ids=[run_id], include=["metadatas"])
    if not res["ids"] or res["metadatas"][0].get("type") != "AGENT_RUN":
        raise HTTPException(status_code=404, detail="Agent run not found")

    try:
        props = json.loads(res["metadatas"][0].get("properties", "{}"))
    except json.JSONDecodeError:
        logger.warning("Corrupt properties JSON for agent run %s during retry", run_id)
        props = {}

    task_id = props.get("task_id", "")
    agent_name = props.get("agent_name", "")
    try:
        from backend.agents.runner import start_agent, execute_agent_bg
        new_run_id = start_agent(task_id, agent_name)
        background_tasks.add_task(execute_agent_bg, task_id, agent_name, new_run_id)
        return {"run_id": new_run_id, "status": "running"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to retry agent for task %s: %s", task_id, e)
        raise HTTPException(status_code=500, detail="Failed to retry agent.")


@router.get("/run-agent/latest")
def get_latest_run(task_id: str):
    from backend.agents.runner import get_latest_run as _get_latest
    return _get_latest(task_id)


# ── Active tasks (control tower) ──────────────────────────────────────────────

@router.get("/active-tasks")
def active_tasks():
    from backend.agents.runner import get_active_tasks
    return get_active_tasks()


# ── Routing rules ─────────────────────────────────────────────────────────────

class RoutingRuleCreate(BaseModel):
    pattern_description: str
    task_type: Optional[str] = None
    executor: str
    mode: str = "always"


@router.get("/routing-rules")
def list_routing_rules():
    from backend.db.connection import get_nodes_collection
    col = get_nodes_collection()
    result = col.get(where={"type": "ROUTING_RULE"}, include=["metadatas"])
    pairs = sorted(
        zip(result["ids"], result["metadatas"]),
        key=lambda x: x[1].get("created_at", 0),
        reverse=True,
    )
    rules = []
    for nid, meta in pairs:
        try:
            props = json.loads(meta.get("properties", "{}"))
        except json.JSONDecodeError:
            logger.warning("Corrupt properties JSON for routing rule %s", nid)
            props = {}
        rules.append({
            "id": nid,
            "label": meta.get("label"),
            "pattern_description": props.get("pattern_description", ""),
            "task_type": props.get("task_type", ""),
            "executor": props.get("executor", ""),
            "mode": props.get("mode", "always"),
            "hit_count": props.get("hit_count", 0),
            "created_at": meta.get("created_at"),
        })
    return rules


@router.post("/routing-rules", status_code=201)
def create_routing_rule(body: RoutingRuleCreate):
    from backend.db.connection import get_nodes_collection
    now = int(time.time() * 1000)
    rule_id = str(uuid.uuid4())
    label = f"Always → {body.executor}: {body.pattern_description[:40]}"

    col = get_nodes_collection()
    col.add(
        ids=[rule_id],
        documents=[label],
        metadatas=[{
            "type": "ROUTING_RULE", "type_version": 1, "label": label,
            "created_at": now, "updated_at": now, "created_by": "user",
            "has_body": 0, "is_inbox": 0, "labels": "[]",
            "properties": json.dumps({
                "pattern_description": body.pattern_description,
                "task_type": body.task_type or "",
                "executor": body.executor,
                "mode": body.mode,
                "hit_count": 0,
            }),
        }],
    )
    return {"id": rule_id, "label": label}


@router.delete("/routing-rules/{rule_id}", status_code=204)
def delete_routing_rule(rule_id: str):
    from backend.db.connection import get_nodes_collection
    col = get_nodes_collection()
    res = col.get(ids=[rule_id], include=["metadatas"])
    if not res["ids"] or res["metadatas"][0].get("type") != "ROUTING_RULE":
        raise HTTPException(status_code=404, detail="Routing rule not found")
    col.delete(ids=[rule_id])
