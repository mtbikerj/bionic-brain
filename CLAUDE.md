# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Bionic Brain is a local-first personal knowledge graph OS. Users capture nodes (notes, tasks, people, etc.), connect them via typed edges, and query/explore the resulting graph. AI (Claude) routes tasks, suggests types, and runs agents.

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
- `main.py` — FastAPI app, CORS, static file serving, router registration; calls `init_db()` on startup; serves built frontend from `frontend/dist` if present
- `config.py` — All config read from `.env` via python-dotenv
- `routers/` — One file per domain: `nodes`, `edges`, `types`, `search`, `settings`, `graph`, `ai`, `backup`, `agents`
- `models/` — Pydantic request/response models
- `db/` — `connection.py` (ChromaDB + SQLite clients, `init_db()`), `seed.py` (built-in node types and edge types)
- `agents/` — Tier 1 (built-in Python), Tier 2 (Claude Code skills), Tier 3 (user-defined)
- `blob/` — Async read/write for rich text bodies stored as TipTap JSON

### Frontend (`frontend/src/`)
- `App.jsx` — React Router routes; full-screen graph as persistent backdrop with floating command bar and right-side drawer for detail views
- `views/` — Page components: `GraphView`, `NodePage`, `InboxView`, `TodayView`, `TypeRegistryView`, `TypeCreateView`, `TypeListView`, `AgentsView`, `SettingsView`
- `components/` — Reusable UI; `CommandBar` is the primary capture/navigation entry point
- `stores/` — Zustand stores; `nodeStore` holds node cache and CRUD methods; `appStore` holds global graph data, search highlights, and type colors (keeps CommandBar and GraphView in sync)
- `api/` — `index.js`: fetch wrappers for all backend endpoints

**Routes:** `/` (graph), `/nodes/:id` (node detail), `/inbox`, `/today`, `/types`, `/types/new`, `/types/:name`, `/agents`, `/settings`

**Keyboard shortcuts:** Ctrl/Cmd+K (command bar), Ctrl/Cmd+N (new node), Ctrl/Cmd+I (inbox), Ctrl/Cmd+G (graph home), Ctrl/Cmd+, (settings), Esc (close drawer)

### Data Model
Every node has: `id` (UUID), `type`, `type_version` (int), `label`, `properties` (dict of custom fields), `labels` (list of string tags), `created_at`, `updated_at`, `created_by`, `has_body`, `is_inbox`, `archived_at`.

Built-in system types: `YEAR`, `MONTH`, `DAY`, `DATETIME`, `PERSON`, `NOTE`, `TASK`, `FILE`, `URL`, `LOCATION`, `AGENT_RUN`, `ROUTING_RULE`, `SCHEMA_VERSION`, `INBOX_ITEM`, `SAVED_SEARCH`.

Every node is auto-linked to a `DAY` node on creation; `DAY → MONTH → YEAR` via `BELONGS_TO` edges — this is how temporal queries work.

Rich text bodies live on disk at `/data/blobs/{node_id[0:2]}/{node_id}/body.json` (TipTap/ProseMirror JSON), not in ChromaDB.

Edges carry optional properties: `role`, `weight`, `note`. Any node can link to any other with any edge type — the model is advised, not enforced by the DB.

Node archiving: nodes are soft-deleted by setting `archived_at` to a timestamp. Types can define `archive_when` rules (e.g., TASK archives when `status` is `"done"` or `"done_silent"`).

### Type System
User-defined types extend built-in types via `EXTENDS` edges (single-level inheritance). Field types: `short_text`, `long_text`, `number`, `currency`, `date`, `boolean`, `choice_single`, `choice_multi`, `relationship`, `file`, `url`, `computed`.

### AI Integration
- Anthropic SDK configured in `config.py` (model defaulting to `claude-opus-4-6`)
- `AI_ENABLED` flag (boolean, default `true`) gates all AI features; stored in `.env`, readable via `backend/config.py`; all `/ai/*` and `/agents` endpoints return 403 when disabled
- Agent tiers: built-in Python agents → Claude Code skills (optional, `CLAUDE_CODE_ENABLED`) → user-defined agents
- Frontend reads `AI_ENABLED` from `getSettings()` at startup into `appStore.aiEnabled`; all AI-dependent UI is conditionally rendered from that store value
- Type creation (`/types/new`) uses an AI chat interface when `aiEnabled=true`, or a manual form (`ManualTypeForm` in `TypeCreateView.jsx`) when disabled
- MCP compatibility is a first-class design goal — do not break it

## Configuration

Copy `.env.example` → `.env` before first run. Key settings:
- `AI_ENABLED` — set to `false` to disable all AI features; also togglable in Settings UI (requires server restart to take effect)
- `ANTHROPIC_API_KEY` — required for AI features when `AI_ENABLED=true`
- `AI_MODEL` — Claude model to use (default: `claude-opus-4-6`)
- `DATA_DIR` — root for all local data
- `BLOB_DIR` — blob storage path (default: `DATA_DIR/blobs`)
- `FILES_DIR` — uploaded file storage (default: `DATA_DIR/files`)
- `CHROMA_DIR` — ChromaDB path (default: `DATA_DIR/chroma`)
- `CLAUDE_CODE_ENABLED` — enable Tier 2 Claude Code skill agents

### ChromaDB metadata rules
- Metadata values must be `str | int | float | bool` — no lists or dicts
- Node extra properties stored as a `properties` JSON string field in metadata
- Node labels (tags) stored as a `labels` JSON string field in metadata
- `has_body` and `is_inbox` stored as `int` (0/1), converted to `bool` in responses
- Temporal node IDs are deterministic: `year-2026`, `month-2026-4`, `day-2026-04-08` — enables upsert without lookup
