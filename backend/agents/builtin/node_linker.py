import json
from backend.agents.base import BaseAgent, AgentContext, AgentResult

_SYSTEM = """You are a knowledge graph assistant. Given a source node and a list of candidate nodes, identify which candidates should be linked to the source and why.

Only suggest links that are genuinely meaningful — shared topic, causal relationship, ownership, reference, etc.

Respond with JSON only:
{
  "links": [
    {"node_id": "...", "edge_type": "RELATED_TO", "reason": "brief reason"},
    ...
  ]
}

Edge types to choose from: RELATED_TO, REFERENCES, PART_OF, ASSIGNED_TO, DEPENDS_ON, RESULTED_IN
If no meaningful links exist, return {"links": []}"""


class NodeLinkerAgent(BaseAgent):
    name = "node_linker"
    description = "Suggests meaningful relationships between this node and others in the graph"
    suitable_for = ["*"]

    def run(self, ctx: AgentContext) -> AgentResult:
        from backend.config import ANTHROPIC_API_KEY, AI_MODEL
        from backend.db.connection import get_nodes_collection
        import anthropic

        node = ctx.node
        node_id = node.get("id")

        # Fetch candidate nodes (recent, excluding temporal and already-linked)
        already_linked = {r["node"].get("id") for r in ctx.related}
        already_linked.add(node_id)

        _SKIP = {"DAY", "MONTH", "YEAR", "SCHEMA_VERSION", "AGENT_RUN", "SAVED_SEARCH"}
        col = get_nodes_collection()
        res = col.get(
            where={"type": {"$nin": list(_SKIP)}},
            include=["metadatas"],
        )
        raw_candidates = []
        for nid, meta in sorted(
            zip(res["ids"], res["metadatas"]),
            key=lambda x: x[1].get("updated_at", 0),
            reverse=True,
        ):
            if nid not in already_linked:
                try:
                    props = json.loads(meta.get("properties", "{}"))
                except Exception:
                    props = {}
                raw_candidates.append({"id": nid, "label": meta.get("label", "?"), "type": meta.get("type", "?"), **props})
        candidates = raw_candidates[:40]

        if not candidates:
            return AgentResult(
                status="complete",
                output_summary="No candidate nodes found to link against.",
                output_json={"links": []},
            )

        source_desc = f"{node.get('label', '?')} (type: {node.get('type', '?')})"
        if ctx.body:
            source_desc += f"\nContent: {ctx.body[:500]}"

        cand_lines = [f"id={c['id']} | {c.get('label', '?')} ({c.get('type', '?')})" for c in candidates[:25]]
        prompt = f"Source node:\n{source_desc}\n\nCandidate nodes:\n" + "\n".join(cand_lines)

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model=AI_MODEL,
            max_tokens=800,
            system=_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        tokens = response.usage.input_tokens + response.usage.output_tokens

        try:
            if "```" in text:
                text = text.split("```")[1].split("```")[0].strip()
                if text.startswith("json"):
                    text = text[4:].strip()
            data = json.loads(text)
        except json.JSONDecodeError:
            return AgentResult(status="failed", error_message="Could not parse link suggestions.", tokens_used=tokens)

        links = data.get("links", [])
        # Enrich with labels for the UI
        cand_map = {c["id"]: c for c in candidates}
        for link in links:
            cand = cand_map.get(link.get("node_id"), {})
            link["node_label"] = cand.get("label", link.get("node_id", "?"))
            link["node_type"] = cand.get("type", "?")

        if links:
            summary_lines = [f"Found {len(links)} suggested link(s):"]
            for lnk in links:
                summary_lines.append(f"  • {lnk['edge_type']} → {lnk['node_label']}: {lnk['reason']}")
            summary = "\n".join(summary_lines)
        else:
            summary = "No meaningful links found between this node and others."

        return AgentResult(
            status="needs_review" if links else "complete",
            output_summary=summary,
            output_json={"links": links},
            tokens_used=tokens,
        )
