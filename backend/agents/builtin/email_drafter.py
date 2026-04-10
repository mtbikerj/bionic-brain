from backend.agents.base import BaseAgent, AgentContext, AgentResult

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
        from backend.config import ANTHROPIC_API_KEY, AI_MODEL
        import anthropic

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model=AI_MODEL,
            max_tokens=800,
            system=_SYSTEM,
            messages=[{"role": "user", "content": _build_prompt(ctx)}],
        )
        draft = response.content[0].text.strip()
        tokens = response.usage.input_tokens + response.usage.output_tokens
        return AgentResult(
            status="needs_review",
            output_summary=draft,
            tokens_used=tokens,
        )
