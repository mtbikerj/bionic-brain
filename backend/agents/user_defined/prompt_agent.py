"""User-defined prompt-template agent.

Users write a system prompt with {{placeholders}}; this agent substitutes them
and calls Claude (via SDK or claude CLI) to produce output.

Available placeholders:
  {{node.label}}           — the item's title/name
  {{node.type}}            — the item's category (e.g. TASK, NOTE)
  {{node.body}}            — the item's rich-text body as plain text
  {{node.properties.X}}   — any property field X
  {{related}}              — bulleted list of related items
"""
import re
import subprocess
from backend.agents.base import AgentContext, AgentResult, BaseAgent
from backend.config import ANTHROPIC_API_KEY, AI_MODEL, AI_MAX_TOKENS_PER_REQUEST, CLAUDE_CODE_ENABLED


def _render_template(template: str, ctx: AgentContext) -> str:
    def replacer(match):
        key = match.group(1).strip()
        if key == "node.label":
            return ctx.node.get("label", "")
        if key == "node.type":
            return ctx.node.get("type", "")
        if key == "node.body":
            return ctx.body or ""
        if key.startswith("node.properties."):
            prop = key[len("node.properties."):]
            return str(ctx.node.get(prop, ""))
        if key == "related":
            if not ctx.related:
                return "(no related items)"
            lines = []
            for r in ctx.related[:20]:
                n = r.get("node", {})
                lines.append(f"- {n.get('label', '?')} [{n.get('type', '?')}] via {r.get('rel_type', '?')}")
            return "\n".join(lines)
        return match.group(0)  # leave unknown placeholders as-is

    return re.sub(r"\{\{([^}]+)\}\}", replacer, template)


class PromptTemplateAgent(BaseAgent):
    def __init__(self, name: str, label: str, description: str,
                 suitable_for: list[str], prompt_template: str,
                 output_format: str = "text", icon: str = "🤖"):
        self.name = name
        self.label = label
        self.description = description
        self.suitable_for = suitable_for
        self.prompt_template = prompt_template
        self.output_format = output_format
        self.icon = icon

    def run(self, ctx: AgentContext) -> AgentResult:
        prompt = _render_template(self.prompt_template, ctx)

        if CLAUDE_CODE_ENABLED:
            return self._run_via_cli(prompt)
        elif ANTHROPIC_API_KEY:
            return self._run_via_sdk(prompt)
        else:
            return AgentResult(
                status="failed",
                error_message="No AI configured. Set ANTHROPIC_API_KEY or enable CLAUDE_CODE_ENABLED.",
            )

    def _run_via_sdk(self, prompt: str) -> AgentResult:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            response = client.messages.create(
                model=AI_MODEL,
                max_tokens=AI_MAX_TOKENS_PER_REQUEST,
                messages=[{"role": "user", "content": prompt}],
            )
            text = response.content[0].text.strip()
            tokens = response.usage.input_tokens + response.usage.output_tokens
            return AgentResult(status="complete", output_summary=text, tokens_used=tokens)
        except Exception as e:
            return AgentResult(status="failed", error_message=str(e))

    def _run_via_cli(self, prompt: str) -> AgentResult:
        try:
            result = subprocess.run(
                ["claude", "-p", prompt],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode != 0:
                return AgentResult(
                    status="failed",
                    error_message=result.stderr.strip() or "claude CLI failed",
                )
            return AgentResult(status="complete", output_summary=result.stdout.strip())
        except FileNotFoundError:
            return AgentResult(status="failed", error_message="claude CLI not found on PATH.")
        except subprocess.TimeoutExpired:
            return AgentResult(status="failed", error_message="Agent timed out after 120s.")
        except Exception as e:
            return AgentResult(status="failed", error_message=str(e))
