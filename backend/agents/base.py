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


class BaseAgent:
    name: str = ""
    description: str = ""
    suitable_for: list[str] = []           # node types; ["*"] means any

    def estimate_tokens(self, ctx: AgentContext) -> int:
        chars = len(ctx.body or "") + len(str(ctx.node)) + sum(len(str(r)) for r in ctx.related)
        return max(200, chars // 4 + 300)  # rough 4 chars/token + prompt overhead

    def run(self, ctx: AgentContext) -> AgentResult:
        raise NotImplementedError
