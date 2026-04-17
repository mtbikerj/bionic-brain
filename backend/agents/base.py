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


def call_chat_ai(system: str, messages: list[dict], max_tokens: int = 800) -> tuple[str, int]:
    """Call the AI model with a multi-turn message list.

    Routes through the Claude Code CLI when CLAUDE_CODE_ENABLED, then dispatches
    to the configured AI_PROVIDER (anthropic or openai).

    Returns (response_text, tokens_used). tokens_used is 0 when using the CLI.
    """
    from backend.config import CLAUDE_CODE_ENABLED, AI_PROVIDER
    if CLAUDE_CODE_ENABLED:
        convo = "\n".join(
            f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
            for m in messages
        )
        full = f"{system}\n\n{convo}" if system else convo
        result = subprocess.run(
            ["claude", "-p", full],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "claude CLI returned a non-zero exit code.")
        return result.stdout.strip(), 0
    elif AI_PROVIDER == "openai":
        from backend.config import OPENAI_API_KEY, AI_MODEL
        try:
            from openai import OpenAI
        except ImportError:
            raise RuntimeError("openai package not installed. Run: pip install openai")
        client = OpenAI(api_key=OPENAI_API_KEY)
        msgs = ([{"role": "system", "content": system}] if system else []) + messages
        response = client.chat.completions.create(
            model=AI_MODEL,
            max_tokens=max_tokens,
            messages=msgs,
        )
        text = response.choices[0].message.content.strip()
        return text, response.usage.prompt_tokens + response.usage.completion_tokens
    else:
        from backend.config import ANTHROPIC_API_KEY, AI_MODEL
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model=AI_MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        )
        return response.content[0].text.strip(), response.usage.input_tokens + response.usage.output_tokens


def call_ai(system: str, prompt: str, max_tokens: int = 800) -> tuple[str, int]:
    """Call the AI model with a single user prompt. Delegates to call_chat_ai."""
    return call_chat_ai(system, [{"role": "user", "content": prompt}], max_tokens)


class BaseAgent:
    name: str = ""
    description: str = ""
    suitable_for: list[str] = []           # node types; ["*"] means any

    def estimate_tokens(self, ctx: AgentContext) -> int:
        chars = len(ctx.body or "") + len(str(ctx.node)) + sum(len(str(r)) for r in ctx.related)
        return max(200, chars // 4 + 300)  # rough 4 chars/token + prompt overhead

    def run(self, ctx: AgentContext) -> AgentResult:
        raise NotImplementedError
