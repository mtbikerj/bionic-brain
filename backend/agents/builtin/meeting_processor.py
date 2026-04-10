import json
from backend.agents.base import BaseAgent, AgentContext, AgentResult

_SYSTEM = """You are a meeting notes processor. Extract structured information from meeting notes.

Respond with JSON only (no markdown):
{
  "summary": "1-2 sentence meeting summary",
  "action_items": [
    {"task": "description", "owner": "name or null", "due": "date or null"}
  ],
  "decisions": ["decision 1", "decision 2"],
  "key_points": ["point 1", "point 2"]
}"""


class MeetingProcessorAgent(BaseAgent):
    name = "meeting_processor"
    description = "Extracts action items, decisions, and key points from meeting notes"
    suitable_for = ["NOTE"]

    def run(self, ctx: AgentContext) -> AgentResult:
        from backend.config import ANTHROPIC_API_KEY, AI_MODEL
        import anthropic

        content = ctx.body or ctx.node.get("label", "")
        if not content.strip():
            return AgentResult(
                status="failed",
                error_message="No content found to process. Add notes to the body of this node first.",
            )

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model=AI_MODEL,
            max_tokens=1000,
            system=_SYSTEM,
            messages=[{"role": "user", "content": f"Meeting notes:\n\n{content[:3000]}"}],
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
            return AgentResult(status="failed", error_message="Could not parse structured output from AI.", tokens_used=tokens)

        action_items = data.get("action_items", [])
        decisions = data.get("decisions", [])
        summary = data.get("summary", "")

        lines = [summary]
        if action_items:
            lines.append(f"\n{len(action_items)} action item(s):")
            for a in action_items:
                owner = f" ({a['owner']})" if a.get("owner") else ""
                due = f" — due {a['due']}" if a.get("due") else ""
                lines.append(f"  • {a['task']}{owner}{due}")
        if decisions:
            lines.append(f"\n{len(decisions)} decision(s):")
            for d in decisions:
                lines.append(f"  • {d}")

        return AgentResult(
            status="needs_review",
            output_summary="\n".join(lines),
            output_json=data,
            tokens_used=tokens,
        )
