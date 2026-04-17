# Bionic Brain

A local-first personal knowledge graph OS. Capture notes, tasks, people, URLs, and more as nodes; connect them with typed edges; explore the resulting graph. AI (Claude) routes tasks, suggests types, and runs agents — all running on your machine with no cloud dependencies beyond the Anthropic API.

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.10+ |
| Node.js | 18+ |
| npm | 9+ |

No Docker required. All data (SQLite, ChromaDB, blobs) lives under `./data/`.

## Quick Start

```bash
# 1. Clone
git clone <repo-url>
cd bionic-brain

# 2. Create a virtual environment (recommended)
python -m venv venv

# 3. Add your Anthropic API key
cp .env.example .env
# Open .env and set ANTHROPIC_API_KEY=sk-ant-...

# 4. Start everything
./start.sh        # macOS / Linux
start.bat         # Windows
```

`start.sh` / `start.bat` will:
- Copy `.env.example` → `.env` if it doesn't exist yet
- Install Python dependencies
- Seed the database with built-in types (idempotent — safe to re-run)
- Start the FastAPI backend on **http://localhost:8000**
- Install npm packages and start the Vite frontend on **http://localhost:3000**

Open **http://localhost:3000** in your browser.

To stop all services:

```bash
./stop.sh     # macOS / Linux
stop.bat      # Windows
```

## Manual Setup (step-by-step)

If you prefer to run services individually:

```bash
# Backend
cd backend
pip install -r requirements.txt
python db/seed.py                          # Create data/graph.db + data/chroma/
uvicorn backend.main:app --reload          # Starts on :8000

# Frontend (in a separate terminal)
cd frontend
npm install
npm run dev                                # Starts on :3000
```

## Configuration

All settings are read from `.env` in the project root. Copy the example file and edit as needed:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | *(required for AI)* | Your Anthropic API key |
| `AI_MODEL` | `claude-opus-4-6` | Claude model to use |
| `AI_MAX_TOKENS_PER_REQUEST` | `4000` | Max tokens per AI call |
| `AI_MONTHLY_WARNING_THRESHOLD_USD` | `10.00` | Spend warning threshold |
| `APP_PORT` | `8000` | Backend port |
| `FRONTEND_PORT` | `3000` | Frontend dev server port |
| `DATA_DIR` | `./data` | Root directory for all local data |
| `BLOB_DIR` | `./data/blobs` | Rich-text body storage |
| `FILES_DIR` | `./data/files` | Uploaded file storage |
| `CHROMA_DIR` | `./data/chroma` | ChromaDB path (optional override) |
| `CLAUDE_CODE_ENABLED` | `true` | Enable Tier 2 Claude Code skill agents |

## Architecture

```
Browser (React @ :3000)
    ↕ HTTP/REST
FastAPI (Python @ :8000)
    ↕ Python API
ChromaDB (embedded, data/chroma/)   — nodes + semantic search
SQLite   (embedded, data/graph.db)  — edges + type definitions
data/blobs/                         — TipTap JSON rich-text bodies
```

- **Backend** (`backend/`) — FastAPI app with routers for nodes, edges, types, search, graph, AI, agents, and settings.
- **Frontend** (`frontend/src/`) — React + Vite SPA. Full-screen interactive graph as the primary view; floating command bar (`Ctrl/Cmd+K`) is the main capture and navigation entry point.
- **AI agents** run in three tiers: built-in Python agents, Claude Code skills (if `CLAUDE_CODE_ENABLED=true`), and user-defined agents.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd+K` | Open command bar |
| `Ctrl/Cmd+N` | New node |
| `Ctrl/Cmd+I` | Inbox |
| `Ctrl/Cmd+G` | Graph home |
| `Ctrl/Cmd+,` | Settings |
| `Esc` | Close drawer |

## API Docs

The FastAPI backend serves interactive API docs at **http://localhost:8000/docs** while the dev server is running.

## Data

All data is stored locally in `./data/` and is never sent anywhere (except text you explicitly route through the Anthropic API for AI features). You can back up the entire graph by copying that directory.

- `data/graph.db` — SQLite: edges and type definitions
- `data/chroma/` — ChromaDB: node embeddings and semantic search index
- `data/blobs/` — Rich-text bodies (TipTap/ProseMirror JSON)
- `data/files/` — Uploaded file attachments
