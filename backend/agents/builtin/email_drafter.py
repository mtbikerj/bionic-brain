from backend.agents.base import BaseAgent, AgentContext, AgentResult, call_ai

_SYSTEM = """You are a professional email drafting assistant. Draft a clear, professional email based on the provided context.

Format your response as:
Subject: [subject line]

[email body]

Keep it concise and appropriate for a professional context. Do not add placeholders like [Name] — use the actual information available or omit gracefully."""


def _build_prompt(ctx: AgentContext) -> str:
    n = ctx.node
    lines = [f"Task/Context: {n.get('label', 'Untitled')}"]
    if ctx.body:
        lines.append(f"\nDetails:\n{ctx.body[:2000]}")
    if ctx.related:
        lines.append("\nRelated context:")
        for r in ctx.related[:8]:
            nd = r["node"]
            lines.append(f"  - {nd.get('label', '?')} ({nd.get('type', '?')})")
    lines.append("\nDraft a professional email based on the above.")
    return "\n".join(lines)


class EmailDrafterAgent(BaseAgent):
    name = "email_drafter"
    description = "Drafts a professional email based on the task and its connected context"
    suitable_for = ["TASK", "NOTE"]

    def run(self, ctx: AgentContext) -> AgentResult:
        draft, tokens = call_ai(_SYSTEM, _build_prompt(ctx), max_tokens=800)
        return AgentResult(status="needs_review", output_summary=draft, tokens_used=tokens)
