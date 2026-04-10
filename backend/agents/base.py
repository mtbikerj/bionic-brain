import subprocess
from dataclasses import dataclass, field
from typing import Any, Literal, Optional


@dataclass
class AgentContext:
    node: dict                              # target node properties
    body: Optional[str]                     # blob body as plain text
    related: list[dict]                     # [{"node": {...}, "rel_type": "..."}]
    run_id: str
    extra: dict = field(default_factory=dict)  # e.g. {"user_reply": "..."}


@dataclass
class AgentResult:
    status: Literal["complete", "needs_you", "needs_review", "failed"]
    output_summary: str = ""
    output_json: dict = field(default_factory=dict)
    tokens_used: int = 0
    error_message: Optional[str] = None
    question: Optional[str] = None         # for needs_you


def call_ai(system: str, prompt: str, max_tokens: int = 800) -> tuple[str, int]:
    """Call the AI model. Routes through the claude CLI when CLAUDE_CODE_ENABLED, else Anthropic API.

    Returns (response_text, tokens_used). tokens_used is 0 when using the CLI.
    """
    from backend.config import CLAUDE_CODE_ENABLED
    if CLAUDE_CODE_ENABLED:
        full = f"{system}\n\n{prompt}" if system else prompt
        result = subprocess.run(
            ["claude", "-p", full],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "claude CLI returned a non-zero exit code.")
        return result.stdout.strip(), 0
    else:
        from backend.config import ANTHROPIC_API_KEY, AI_MODEL
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model=AI_MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text.strip(), response.usage.input_tokens + response.usage.output_tokens


class BaseAgent:
    name: str = ""
    description: str = ""
    suitable_for: list[str] = []           # node types; ["*"] means any

    def estimate_tokens(self, ctx: AgentContext) -> int:
        chars = len(ctx.body or "") + len(str(ctx.node)) + sum(len(str(r)) for r in ctx.related)
        return max(200, chars // 4 + 300)  # rough 4 chars/token + prompt overhead

    def run(self, ctx: AgentContext) -> AgentResult:
        raise NotImplementedError
