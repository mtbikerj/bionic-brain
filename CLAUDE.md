# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Bionic Brain is a local-first personal knowledge graph OS. Users capture nodes (notes, tasks, people, etc.), connect them via typed edges, and query/explore the resulting graph. AI (Claude) routes tasks, suggests types, and runs agents. The design document at `DESIGN.md` is the authoritative spec — read it before making architectural decisions.

## Commands

### Start / Stop All Services
```bash
./start.sh   # Installs deps, seeds DB, starts FastAPI backend and Vite frontend
./stop.sh    # Stops all services
```

### Backend (Python / FastAPI)
```bash
cd backend
pip install -r requirements.txt
python db/seed.py                        # Seed built-in types (run once after DB reset)
uvicorn backend.main:app --reload        # Dev server on :8000
```

### Frontend (React / Vite)
```bash
cd frontend
npm install
npm run dev      # Dev server on :3000
npm run build    # Production build
npm run lint     # ESLint
npm run preview  # Preview production build
```

### Database
No Docker required. The DB initializes automatically on startup:
```bash
python backend/db/seed.py   # Create data/graph.db + data/chroma/ with built-in types
```

## Architecture

Four layers, all local — no Docker:

```
Browser (React @ :3000)
    ↕ HTTP/REST
FastAPI (Python @ :8000)
    ↕ Python API
ChromaDB (embedded, data/chroma/)   — nodes + semantic search
SQLite   (embedded, data/graph.db)  — edges + type definitions
/data/blobs/                        — TipTap JSON rich-text bodies
```

### Backend (`backend/`)
- `main.py` — FastAPI app, CORS, static file serving, router registration; calls `init_db()` on startup
- `config.py` — All config read from `.env` via python-dotenv
- `routers/` — One file per domain: `nodes`, `edges`, `types`, `search`, `settings`, `graph`, `ai`, `backup`, `agents`
- `models/` — Pydantic request/response models
- `db/` — `connection.py` (ChromaDB + SQLite clients, `init_db()`), `seed.py` (built-in types)
- `agents/` — Tier 1 (built-in Python), Tier 2 (Claude Code skills), Tier 3 (user-defined)
- `blob/` — Async read/write for rich text bodies stored as TipTap JSON

### Frontend (`frontend/src/`)
- `App.jsx` — React Router 7 route definitions
- `views/` — Page components: Home, Inbox, Today, Search, NodeDetail, TypeList
- `components/` — Reusable UI components
- `stores/` — Zustand stores; central `nodeStore` holds node cache and CRUD methods
- `api/` — Thin fetch wrappers for each backend endpoint

### Data Model
Every node has: `id` (UUID), `type`, `label`, `created_at`, `updated_at`, `created_by`, `has_body`, `is_inbox`.

Built-in system types: `YEAR`, `MONTH`, `DAY`, `PERSON`, `NOTE`, `TASK`, `FILE`, `URL`, `LOCATION`, `AGENT_RUN`, `ROUTING_RULE`, `SCHEMA_VERSION`, `INBOX_ITEM`.

Every node is auto-linked to a `DAY` node on creation; `DAY → MONTH → YEAR` via `BELONGS_TO` edges — this is how temporal queries work.

Rich text bodies live on disk at `/data/blobs/{node_id[0:2]}/{node_id}/body.json` (TipTap/ProseMirror JSON), not in ChromaDB.

Edges carry optional properties: `role`, `weight`, `note`. Any node can link to any other with any edge type — the model is advised, not enforced by the DB.

### Type System
User-defined types extend built-in types via `EXTENDS` edges (single-level inheritance). Field types: `short_text`, `long_text`, `number`, `currency`, `date`, `boolean`, `choice_single`, `choice_multi`, `relationship`, `file`, `url`, `computed`.

### AI Integration
- Anthropic SDK configured in `config.py` (model defaulting to `claude-opus-4-6`)
- Agent tiers: built-in Python agents → Claude Code skills (optional, `CLAUDE_CODE_ENABLED`) → user-defined agents
- MCP compatibility is a first-class design goal — do not break it

## Configuration

Copy `.env.example` → `.env` before first run. Key settings:
- `ANTHROPIC_API_KEY` — required for AI features
- `DATA_DIR` — root for blobs, files, ChromaDB (`data/chroma/`), and SQLite (`data/graph.db`)
- `CHROMA_DIR` — override ChromaDB path (default: `DATA_DIR/chroma`)

### ChromaDB metadata rules
- Metadata values must be `str | int | float | bool` — no lists or dicts
- Node extra properties go into a `properties` JSON string field in metadata
- `has_body` and `is_inbox` stored as `int` (0/1), converted to `bool` in responses
- Temporal node IDs are deterministic: `year-2026`, `month-2026-4`, `day-2026-04-08` — enables upsert without lookup
