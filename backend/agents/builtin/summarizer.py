from backend.agents.base import BaseAgent, AgentContext, AgentResult, call_ai

_SYSTEM = """You are a knowledge graph assistant. Summarize the provided node and its context.

Write 2–4 clear sentences covering:
- What this node is about
- Key property values worth noting
- How it relates to connected nodes (if any)

Be concise and factual. No preamble."""

_SKIP_PROPS = {"id", "type", "label", "created_at", "updated_at", "created_by",
               "has_body", "is_inbox", "type_version", "labels"}


def _build_prompt(ctx: AgentContext) -> str:
    n = ctx.node
    lines = [f"Node: {n.get('label', 'Untitled')} (type: {n.get('type', '?')})"]
    props = {k: v for k, v in n.items() if k not in _SKIP_PROPS and v not in (None, "", [], {})}
    if props:
        lines.append("Properties:")
        for k, v in props.items():
            lines.append(f"  {k}: {v}")
    if ctx.body:
        lines.append(f"\nContent:\n{ctx.body[:3000]}")
    if ctx.related:
        lines.append(f"\nConnected nodes ({len(ctx.related)}):")
        for r in ctx.related[:12]:
            nd = r["node"]
            lines.append(f"  [{r['rel_type']}] {nd.get('label', '?')} ({nd.get('type', '?')})")
    return "\n".join(lines)


class SummarizerAgent(BaseAgent):
    name = "summarizer"
    description = "Summarizes a node's content and its connections into a concise overview"
    suitable_for = ["NOTE", "TASK", "INBOX_ITEM", "FILE", "URL"]

    def run(self, ctx: AgentContext) -> AgentResult:
        summary, tokens = call_ai(_SYSTEM, _build_prompt(ctx), max_tokens=600)
        return AgentResult(status="complete", output_summary=summary, tokens_used=tokens)
