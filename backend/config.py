from dotenv import load_dotenv
import os

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "claude-opus-4-6")
AI_MAX_TOKENS_PER_REQUEST = int(os.getenv("AI_MAX_TOKENS_PER_REQUEST", "4000"))
AI_MONTHLY_WARNING_THRESHOLD_USD = float(os.getenv("AI_MONTHLY_WARNING_THRESHOLD_USD", "10.00"))

CLAUDE_CODE_ENABLED = os.getenv("CLAUDE_CODE_ENABLED", "false").lower() == "true"
CLAUDE_CODE_SKILLS_PATH = os.getenv("CLAUDE_CODE_SKILLS_PATH", "")

APP_PORT = int(os.getenv("APP_PORT", "8000"))
DATA_DIR = os.getenv("DATA_DIR", "./data")
BLOB_DIR = os.getenv("BLOB_DIR", "./data/blobs")
FILES_DIR = os.getenv("FILES_DIR", "./data/files")
CHROMA_DIR = os.getenv("CHROMA_DIR", os.path.join(DATA_DIR, "chroma"))
