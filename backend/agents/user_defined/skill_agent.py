"""Agent that executes a Claude Code skill file via the `claude` CLI.

A skill file is a plain Markdown prompt template. On each run, the file is
read fresh (so edits take effect without restart), the node context is appended,
and the result is returned as an AgentResult.
"""
import subprocess
from pathlib import Path

from backend.agents.base import AgentContext, AgentResult, BaseAgent


class SkillFileAgent(BaseAgent):
    def __init__(self, skill_path: str, name: str, description: str = ""):
        self.skill_path = skill_path
        self.name = name
        self.description = description
        self.suitable_for = ["*"]

    def run(self, ctx: AgentContext) -> AgentResult:
        try:
            skill_content = Path(self.skill_path).read_text(encoding="utf-8").strip()
        except OSError as e:
            return AgentResult(status="failed", error_message=f"Could not read skill file: {e}")

        related_text = ""
        if ctx.related:
            lines = [
                f"- {r['node'].get('label', '?')} [{r['node'].get('type', '?')}] via {r.get('rel_type', '?')}"
                for r in ctx.related[:20]
            ]
            related_text = "\n".join(lines)

        context_block = (
            f"\n\n---\nApply the above to this item:\n"
            f"Title: {ctx.node.get('label', '')}\n"
            f"Type: {ctx.node.get('type', '')}\n"
        )
        if ctx.body:
            context_block += f"Content:\n{ctx.body}\n"
        if related_text:
            context_block += f"\nRelated items:\n{related_text}\n"

        full_prompt = skill_content + context_block

        try:
            result = subprocess.run(
                ["claude", "-p", full_prompt],
                capture_output=True, text=True, timeout=120,
            )
        except FileNotFoundError:
            return AgentResult(status="failed", error_message="claude CLI not found on PATH.")
        except subprocess.TimeoutExpired:
            return AgentResult(status="failed", error_message="Skill timed out after 120s.")
        except Exception as e:
            return AgentResult(status="failed", error_message=str(e))

        if result.returncode != 0:
            return AgentResult(
                status="failed",
                error_message=result.stderr.strip() or "claude CLI returned a non-zero exit code.",
            )

        return AgentResult(status="complete", output_summary=result.stdout.strip())
