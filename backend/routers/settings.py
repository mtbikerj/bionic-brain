import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/settings", tags=["settings"])

ENV_PATH = os.path.join(os.path.dirname(__file__), "..", "..", ".env")

EDITABLE_KEYS = {
    "AI_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
    "AI_MODEL", "AI_MAX_TOKENS_PER_REQUEST",
    "AI_MONTHLY_WARNING_THRESHOLD_USD", "CLAUDE_CODE_ENABLED",
    "CLAUDE_CODE_SKILLS_PATH", "APP_PORT",
}


class SettingsUpdate(BaseModel):
    key: str
    value: str


def _read_env() -> dict[str, str]:
    result = {}
    if not os.path.exists(ENV_PATH):
        return result
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, _, v = line.partition("=")
                result[k.strip()] = v.strip()
    return result


def _write_env(data: dict[str, str]):
    lines = []
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()

    new_lines = []
    written = set()
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            new_lines.append(line)
            continue
        if "=" in stripped:
            k = stripped.split("=", 1)[0].strip()
            if k in data:
                new_lines.append(f"{k}={data[k]}\n")
                written.add(k)
            else:
                new_lines.append(line)

    for k, v in data.items():
        if k not in written:
            new_lines.append(f"{k}={v}\n")

    with open(ENV_PATH, "w", encoding="utf-8") as f:
        f.writelines(new_lines)


@router.get("")
def get_settings():
    env = _read_env()
    # Never return API key values over HTTP — only expose whether they're configured.
    masked = {"ANTHROPIC_API_KEY", "OPENAI_API_KEY"}
    result = {k: v for k, v in env.items() if k not in masked}
    result["ANTHROPIC_API_KEY_SET"] = bool(env.get("ANTHROPIC_API_KEY", "").strip())
    result["OPENAI_API_KEY_SET"] = bool(env.get("OPENAI_API_KEY", "").strip())
    return result


@router.put("")
def update_settings(updates: list[SettingsUpdate]):
    env = _read_env()
    for u in updates:
        if u.key not in EDITABLE_KEYS:
            raise HTTPException(status_code=400, detail=f"Key '{u.key}' is not editable")
        env[u.key] = u.value
    _write_env(env)
    return {"ok": True}
