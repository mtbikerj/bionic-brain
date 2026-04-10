"""CRUD for user-defined agents stored as CUSTOM_AGENT nodes in ChromaDB."""
import json
import time
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.db.connection import get_nodes_collection

router = APIRouter(prefix="/agents", tags=["agents"])


class CustomAgentCreate(BaseModel):
    name: str
    label: str
    description: str = ""
    icon: str = "🤖"
    suitable_for: list[str] = ["*"]
    prompt_template: str
    output_format: str = "text"


class CustomAgentUpdate(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    suitable_for: Optional[list[str]] = None
    prompt_template: Optional[str] = None
    output_format: Optional[str] = None


def _meta_to_agent(node_id: str, meta: dict) -> dict:
    try:
        props = json.loads(meta.get("properties", "{}"))
    except Exception:
        props = {}
    return {
        "id": node_id,
        "name": props.get("name"),
        "label": meta.get("label"),
        "description": props.get("description", ""),
        "icon": props.get("icon", "🤖"),
        "suitable_for": props.get("suitable_for", ["*"]),
        "prompt_template": props.get("prompt_template", ""),
        "output_format": props.get("output_format", "text"),
        "created_at": meta.get("created_at"),
        "updated_at": meta.get("updated_at"),
    }


def _now() -> int:
    return int(time.time() * 1000)


@router.get("")
def list_custom_agents():
    col = get_nodes_collection()
    result = col.get(where={"type": "CUSTOM_AGENT"}, include=["metadatas"])
    pairs = sorted(zip(result["ids"], result["metadatas"]), key=lambda x: x[1].get("created_at", 0))
    return [_meta_to_agent(nid, meta) for nid, meta in pairs]


@router.post("", status_code=201)
def create_custom_agent(body: CustomAgentCreate):
    name = body.name.lower().replace(" ", "_")
    now = _now()
    agent_id = str(uuid.uuid4())

    col = get_nodes_collection()
    existing = col.get(where={"type": "CUSTOM_AGENT"}, include=["metadatas"])
    for nid, meta in zip(existing["ids"], existing["metadatas"]):
        try:
            props = json.loads(meta.get("properties", "{}"))
        except Exception:
            props = {}
        if props.get("name") == name:
            raise HTTPException(status_code=409, detail=f"Agent '{name}' already exists.")

    col.add(
        ids=[agent_id],
        documents=[body.label],
        metadatas=[{
            "type": "CUSTOM_AGENT", "type_version": 1, "label": body.label,
            "created_at": now, "updated_at": now, "created_by": "user",
            "has_body": 0, "is_inbox": 0, "labels": "[]",
            "properties": json.dumps({
                "name": name,
                "description": body.description,
                "icon": body.icon,
                "suitable_for": body.suitable_for,
                "prompt_template": body.prompt_template,
                "output_format": body.output_format,
            }),
        }],
    )
    res = col.get(ids=[agent_id], include=["metadatas"])
    agent_data = _meta_to_agent(agent_id, res["metadatas"][0])

    from backend.agents.runner import register_custom_agent
    register_custom_agent(agent_data)

    return agent_data


@router.patch("/{name}")
def update_custom_agent(name: str, body: CustomAgentUpdate):
    now = _now()
    col = get_nodes_collection()

    # Find the agent by name in properties
    result = col.get(where={"type": "CUSTOM_AGENT"}, include=["metadatas"])
    agent_id = None
    agent_meta = None
    for nid, meta in zip(result["ids"], result["metadatas"]):
        try:
            props = json.loads(meta.get("properties", "{}"))
        except Exception:
            props = {}
        if props.get("name") == name:
            agent_id = nid
            agent_meta = meta
            break

    if not agent_id:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found.")

    meta = dict(agent_meta)
    meta["updated_at"] = now
    try:
        props = json.loads(meta.get("properties", "{}"))
    except Exception:
        props = {}

    if body.label is not None:
        meta["label"] = body.label
    if body.description is not None:
        props["description"] = body.description
    if body.icon is not None:
        props["icon"] = body.icon
    if body.suitable_for is not None:
        props["suitable_for"] = body.suitable_for
    if body.prompt_template is not None:
        props["prompt_template"] = body.prompt_template
    if body.output_format is not None:
        props["output_format"] = body.output_format

    meta["properties"] = json.dumps(props)
    col.update(ids=[agent_id], documents=[meta["label"]], metadatas=[meta])

    agent_data = _meta_to_agent(agent_id, meta)
    from backend.agents.runner import register_custom_agent
    register_custom_agent(agent_data)
    return agent_data


@router.delete("/{name}", status_code=204)
def delete_custom_agent(name: str):
    col = get_nodes_collection()
    result = col.get(where={"type": "CUSTOM_AGENT"}, include=["metadatas"])
    agent_id = None
    for nid, meta in zip(result["ids"], result["metadatas"]):
        try:
            props = json.loads(meta.get("properties", "{}"))
        except Exception:
            props = {}
        if props.get("name") == name:
            agent_id = nid
            break

    if not agent_id:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found.")

    col.delete(ids=[agent_id])
    from backend.agents.runner import unregister_custom_agent
    unregister_custom_agent(name)
