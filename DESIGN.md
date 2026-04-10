# Personal Knowledge OS — Design Document
> Version 1.0 | Status: Initial Specification

---

## Table of Contents

1. [Vision & Purpose](#1-vision--purpose)
2. [System Architecture](#2-system-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Data Model](#4-data-model)
5. [Type System & Ontology](#5-type-system--ontology)
6. [Relationship Model](#6-relationship-model)
7. [AI Routing Model](#7-ai-routing-model)
8. [Agent System](#8-agent-system)
9. [Search System](#9-search-system)
10. [UI Architecture](#10-ui-architecture)
11. [Views](#11-views)
12. [Node View](#12-node-view)
13. [Graph Visualization](#13-graph-visualization)
14. [Notification & Interruption Model](#14-notification--interruption-model)
15. [Schema Versioning](#15-schema-versioning)
16. [Storage & Blob Architecture](#16-storage--blob-architecture)
17. [Settings & Configuration](#17-settings--configuration)
18. [Project Structure](#18-project-structure)
19. [Build & Run](#19-build--run)
20. [Implementation Phases](#20-implementation-phases)

---

## 1. Vision & Purpose

A **personal knowledge operating system** — a local-first, open-source, AI-integrated graph database for a person's complete catalog of knowledge, tasks, artifacts, and relationships.

### Core Principles

- **Everything is a node.** Tasks, notes, people, projects, coins, books, days — all are nodes in a unified graph.
- **Relationships are first-class.** Edges between nodes are typed, directional, and carry properties. They are not afterthoughts.
- **AI is woven in, not bolted on.** The AI assists schema creation, routes tasks, runs agents, and reasons about the graph — but always defers to the user.
- **Local-first, portable.** All data lives on the user's machine. Moving it is as simple as copying a folder.
- **Non-technical users first.** The system is powerful but never exposes that complexity unless the user asks for it.
- **Open source.** No vendor lock-in, no subscriptions, no cloud dependency beyond the user's own AI API key.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 4 — UI                                               │
│  React + D3 · localhost:3000 · Desktop browser              │
│  Mouse-first, keyboard shortcuts, fast everywhere           │
├─────────────────────────────────────────────────────────────┤
│  LAYER 3 — AI                                               │
│  Routing engine · Agent runner · Schema assistant           │
│  Works on subgraphs only · User-linked API keys             │
│  Claude API + Claude Code skills + user-defined agents      │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2 — ONTOLOGY                                         │
│  User-defined types + built-in system types                 │
│  Loose relationship model · AI-assisted schema creation     │
│  Schema versioning with user-controlled migration           │
├─────────────────────────────────────────────────────────────┤
│  LAYER 1 — GRAPH STORAGE                                    │
│  Memgraph (local Docker) · Content blobs by node ID         │
│  Typed nodes + typed edges + edge properties                │
│  Portable — zip the data directory and move it              │
└─────────────────────────────────────────────────────────────┘
```

### Runtime Architecture

```
Browser (React UI)
    ↕ HTTP / WebSocket
FastAPI Server (Python) — localhost:3000
    ↕ Bolt protocol (Python driver)
Memgraph (Docker container) — localhost:7687
    +
File System (blob store) — /data/blobs/
    +
.env (config, API keys)
```

All services start together via a single `docker-compose.yml`. The user runs one script and opens one browser tab. Everything else is invisible.

---

## 3. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Graph database | **Memgraph** (local Docker) | Active OSS, Cypher query language, in-memory speed, persistence, Neo4j compatible |
| Backend | **Python + FastAPI** | Best AI/LLM ecosystem, Memgraph Python driver, async-native, Claude Code affinity |
| Frontend | **React + Vite** | Component model, fast builds, familiar (matches existing portfolio sites) |
| Graph visualization | **D3.js** | Gold standard for custom graph rendering, force-directed layout, full control |
| Rich text editor | **TipTap** | ProseMirror-based, extensible, stores as JSON, handles large bodies |
| Containerization | **Docker Compose** | Bundles Memgraph + FastAPI, single command startup |
| AI | **Anthropic Claude API** (user key) | Primary AI provider |
| AI alt | **Claude Code skills** | Agent catalog extension |
| Config | **.env file + Settings UI** | User never edits .env directly |
| Blob store | **Local filesystem** | Two-level directory structure by node ID prefix |

### Why Not Tauri / Electron

A local web app (FastAPI + browser) is chosen over a packaged executable because:
- No packaging or distribution complexity
- Easier for Claude Code to build and iterate on
- Portable by copying a folder
- No OS-specific build tooling required
- User interacts via a browser tab they already know how to use

---

## 4. Data Model

### Node Structure (Memgraph)

Every node in the graph has the following base properties regardless of type:

```cypher
CREATE NODE TABLE BaseNode (
  id          UUID PRIMARY KEY,       -- globally unique node ID
  type        STRING,                 -- type name (e.g. "Coin", "Task", "Person")
  type_version INTEGER,               -- schema version this node was created on
  label       STRING,                 -- display name / title
  created_at  TIMESTAMP,
  updated_at  TIMESTAMP,
  created_by  STRING,                 -- "user" or agent ID
  has_body    BOOLEAN DEFAULT false,  -- whether a blob file exists for this node
  is_inbox    BOOLEAN DEFAULT false   -- unclassified capture node
)
```

Type-specific properties are stored as additional properties on the same node — Memgraph's property graph model allows arbitrary properties per node without a fixed schema per label.

### Edge Structure (Memgraph)

Every edge has:

```cypher
-- Example edge creation
MATCH (a), (b) WHERE a.id = $from_id AND b.id = $to_id
CREATE (a)-[:RELATIONSHIP_TYPE {
  id:         UUID,
  created_at: TIMESTAMP,
  created_by: STRING,
  -- optional type-specific properties:
  role:       STRING,   -- e.g. on ASSIGNED_TO: "owner", "reviewer"
  weight:     FLOAT,    -- optional strength/relevance
  note:       STRING    -- optional annotation on the relationship itself
}]->(b)
```

### Blob Reference

When `has_body = true`, the node's content body is stored at:

```
/data/blobs/{node_id[0:2]}/{node_id}/body.json
```

The body is stored as TipTap/ProseMirror JSON — a rich, portable format that supports headings, lists, inline code, images, and embedded node references.

---

## 5. Type System & Ontology

### 5.1 Built-in System Types

These types are pre-installed, used by the system internally, and cannot be deleted. Users may add custom fields to them.

#### Temporal Types

```
YEAR        { year: INT }
MONTH       { year: INT, month: INT, label: STRING }
              → BELONGS_TO → YEAR
DAY         { date: DATE, label: STRING }
              → BELONGS_TO → MONTH
DATETIME    { timestamp: TIMESTAMP }
              → BELONGS_TO → DAY
```

Temporal nodes are real graph nodes. This enables traversal queries like "show me everything linked to March 2025" without any special date logic — it's just a graph walk. Every node created on a given day is automatically linked to the corresponding DAY node.

#### Core Knowledge Types

```
PERSON      { name: STRING, email: STRING, phone: STRING,
              title: STRING, organization: STRING }

NOTE        { title: STRING }
              body: blob (rich text)

TASK        { title: STRING, status: ENUM, priority: ENUM,
              due_date: DATE }
              → ASSIGNED_TO → PERSON (optional)
              → DUE_ON → DAY (optional)

FILE        { filename: STRING, mime_type: STRING,
              size_bytes: INT, file_path: STRING }

URL         { href: STRING, title: STRING,
              description: STRING, snapshot_date: DATE }

LOCATION    { name: STRING, address: STRING,
              lat: FLOAT, lng: FLOAT, region: STRING }
```

#### AI / System Types

```
AGENT_RUN   { task_id: UUID, agent_name: STRING,
              started_at: TIMESTAMP, ended_at: TIMESTAMP,
              status: ENUM, token_cost_estimate: INT,
              output_summary: STRING }
              → RAN_ON → DAY
              → ACTED_ON → (any node)

ROUTING_RULE { pattern_description: STRING,
               task_type: STRING, executor: ENUM,
               mode: ENUM,   -- "suggest" | "always"
               created_at: TIMESTAMP,
               hit_count: INT }

SCHEMA_VERSION { type_name: STRING, version: INT,
                 changes: STRING, created_at: TIMESTAMP }
```

#### Capture Type

```
INBOX_ITEM  { raw_text: STRING, captured_at: TIMESTAMP }
              body: blob (optional)
```

Untyped. AI passively suggests a proper type. User can dismiss, convert, or leave indefinitely.

### 5.2 User-Defined Types

Users define new types via an AI-assisted conversation flow. The system never shows a "create table" form.

#### Type Definition Flow

```
User:  "I want to track my coin collection"

AI:    "Here's a starting point for a Coin type.
        Does this look right?

        COIN
        ├── Denomination    (short text)
        ├── Year            (number)
        ├── Country         (short text)
        ├── Mint Mark       (short text)
        ├── Grade           (choice: MS60–MS70, AU58, EF45, VF30...)
        ├── Type            (short text)
        ├── Purchase Price  (currency)
        ├── Current Value   (currency)
        └── Notes           (rich text)

        Want to add, remove, or rename anything?"

User:  "Add a photo field and a 'for sale' toggle"

AI:    "Done. Added:
        ├── Photo           (image)
        └── For Sale        (yes/no)
        Ready to create the Coin type?"
```

The AI does domain-knowledge heavy lifting. The user only reacts. Once approved, the type is registered in the type registry and immediately usable.

#### Supported Field Types

| Type | Description | Example |
|---|---|---|
| `short_text` | Single line string | Name, mint mark |
| `long_text` | Rich text body (blob) | Notes, description |
| `number` | Integer or decimal | Year, quantity |
| `currency` | Number with currency formatting | Purchase price |
| `date` | Calendar date | Acquired on |
| `datetime` | Date + time | Due at |
| `boolean` | Yes / No toggle | For sale, is insured |
| `choice_single` | Enum, one selection | Grade, status |
| `choice_multi` | Enum, multiple selections | Categories |
| `relationship` | Edge to another node type | Owner → Person |
| `file` | Attached file reference | Photo, PDF |
| `url` | Web link | Reference |
| `computed` | Derived from other fields | Gain/loss |

### 5.3 Labels (Lightweight, Temporary)

Labels are not tags. They are capture-oriented, temporary markers — training wheels toward proper types.

- Any node can have any label
- Labels are stored as a `STRING[]` property on the node
- No label-specific schema or validation
- AI monitors label usage via a lightweight counter index (not graph scans)
- When a label is applied to 10+ nodes, AI suggests: "You've labeled 12 nodes as 'client' — want me to create a Client type?"
- Labels are explicitly presented in the UI as temporary

### 5.4 Inheritance

One level of inheritance only. A `RareCoin` can extend `Coin` (inherits all fields, adds its own). A type extending `RareCoin` is blocked — AI suggests adding fields to `RareCoin` instead.

Inheritance is stored as a `EXTENDS` edge between type definition nodes in the type registry.

### 5.5 Loose Relationship Model

Any node can be linked to any other node with any edge type at any time. The schema is advisory, not enforced. When a user creates an unusual relationship (e.g., Coin → Project), the AI notices and offers: "Want to formalize this as a relationship type on Project?"

The system nudges toward structure without blocking spontaneity.

---

## 6. Relationship Model

### 6.1 Built-in Edge Types

#### Structural
| Edge | From | To | Description |
|---|---|---|---|
| `HAS_MEMBER` | any container | any node | Folder contains coins, project contains tasks |
| `CONTAINS` | any | any | Generic containment |
| `PART_OF` | any | any | Inverse of CONTAINS |

#### Ownership / Assignment
| Edge | From | To | Description |
|---|---|---|---|
| `OWNED_BY` | any | PERSON | Ownership |
| `ASSIGNED_TO` | TASK | PERSON | Task responsibility (edge has `role` property) |
| `CREATED_BY` | any | PERSON | Authorship |

#### Dependency / Flow
| Edge | From | To | Description |
|---|---|---|---|
| `DEPENDS_ON` | TASK | TASK | Task prerequisite |
| `BLOCKS` | any | TASK | Blocker |
| `TRIGGERS` | any | TASK | Causes creation of |

#### Reference / Context
| Edge | From | To | Description |
|---|---|---|---|
| `REFERENCES` | any | any | Cites or uses |
| `INFORMED_BY` | any | any | Context/research for |
| `RELATED_TO` | any | any | Generic catch-all |

#### Temporal
| Edge | From | To | Description |
|---|---|---|---|
| `LINKED_TO` | any | DAY/MONTH/YEAR | Time association |
| `DUE_ON` | TASK | DAY | Due date |
| `COMPLETED_ON` | TASK | DAY | Completion date |
| `PRECEDED_BY` | any | any | Sequence |
| `RESULTED_IN` | any | any | Causation |

### 6.2 User-Defined Edge Types

Users can define custom relationship types as part of type definition. They have a name, optional inverse name, optional edge properties, and directionality.

Example:
```
Edge type: GRADED_BY
From: COIN
To: PERSON or ORGANIZATION
Inverse label: GRADED
Properties: grade_date (date), service (short_text)
```

### 6.3 Edge Display Rules

- **Same-type children** render as indented list (tasks under tasks, sub-projects under projects) — one level deep by default
- **Cross-type relationships** render as linked chips/pills on the node card (not indented)
- **Circular references** get a visual warning indicator — detected and flagged, never cause errors
- **Deep hierarchy** is accessed by clicking into a child node (breadcrumb navigation)

---

## 7. AI Routing Model

### 7.1 Overview

Every task node is evaluated for routing. The system answers: "Who is the best executor — human, AI agent, or a specific tool?"

This is always a suggestion. The user decides. Over time, the user can authorize the system to always route certain task types to AI.

### 7.2 Routing Decision Signals

The AI evaluates five signals per task:

| Signal | Description | Weight |
|---|---|---|
| Task type | What kind of work is this? | High |
| Agent match | Does a known agent/skill exist for this? | High |
| Judgment requirement | Does this require personal judgment or relationships? | High |
| Learned preference | Has the user previously approved AI for this pattern? | Very High |
| Confidence score | How certain is the AI in its routing suggestion? | Medium |

### 7.3 Task States

```
Inbox
  → In Progress (You)    — user is actively working it
  → In Progress (Agent)  — agent is running
      → Needs You        — agent paused, waiting on input
      → Needs Review     — agent finished a step, user should look
      → Agent Complete   — agent done, brief summary ready
      → Done — Silent    — complete, user pre-approved no notification
      → Failed           — error, always surfaced to user visually
  → Blocked              — waiting on another task or person
  → Done
```

### 7.4 Completion Categories

| State | Icon | Trigger | User Action |
|---|---|---|---|
| `done_silent` | 🔇 | User pre-approved "never notify" | None |
| `agent_complete` | ✅ | Agent finished, worth a glance | Read summary, confirm |
| `needs_review` | 👁️ | Output needs human review | Review, approve/reject/iterate |
| `needs_you` | 🔔 | Agent hit a decision point | Answer question or take over |
| `failed` | 🚨 | Any error condition | Retry / modify / take over |

**No silent failures.** Every failure surfaces to the user with a visual indicator and a plain-English explanation of what went wrong.

### 7.5 Agent Complete Summary Format

When an agent finishes, the summary card shows:

```
✅ Agent Complete: Weekly Status Draft

What I did:
Pulled your notes from this week, summarized 3 projects,
drafted a 200-word status email.

Output: [Draft email — click to view]

Time taken: 1m 42s  |  Est. tokens used: ~1,400 (~$0.002)

[ Looks good — Done ]  [ Open & Edit ]  [ Redo with changes ]
```

### 7.6 The Learning Loop

When a user clicks "Always use AI for this type":

1. A `ROUTING_RULE` node is created with the task pattern
2. Future matching tasks are auto-routed without prompting
3. Rules are visible and editable in Settings → Routing Rules
4. The AI periodically surfaces rules: "I've been auto-handling your weekly summaries for 3 weeks. Still want me to do that?"

Rules are matched on: task type, title keywords, relationship context, and assigned agent.

### 7.7 The Bouncing Model

Tasks bounce between user and agents. The task card maintains a full thread:

```
YOU                          AI AGENT
 │                               │
 ├──── assign task ─────────────►│
 │                               │ (working...)
 │◄─── needs clarification ──────┤
 ├──── provide answer ──────────►│
 │                               │ (working...)
 │◄─── step complete, review ────┤
 ├──── approve ─────────────────►│
 │                               │ DONE
```

The task card shows this thread as a chronological activity log. Every handoff is timestamped and labeled (user action / agent action).

### 7.8 Token Cost Awareness

- Every agent run estimates token cost before starting (based on input size and task type)
- Actual cost is recorded on the `AGENT_RUN` node after completion
- Estimates and actuals are shown on the task card and in the agent complete summary
- A running monthly total is shown in Settings → AI Usage
- No hard limits enforced by default, but user can set a soft warning threshold

---

## 8. Agent System

### 8.1 Agent Catalog

Three tiers of agents, all accessible through the same UI:

**Tier 1 — Built-in agents** (ship with the system)
- Document Summarizer — summarizes any node with a body
- Web Researcher — searches the web and returns structured findings
- Email Drafter — drafts an email given context nodes
- Meeting Notes Processor — extracts action items and decisions from notes
- Node Linker — finds and suggests relationships between existing nodes
- Value Researcher — looks up current market value for collectible items

**Tier 2 — Claude Code skills**
If the user has Claude Code configured, its skill ecosystem is automatically available as agents. The system detects Claude Code configuration and surfaces compatible skills in the agent catalog.

**Tier 3 — User-defined agents**
Users describe what they want an agent to do in plain English. The AI generates a prompt template and wraps it as a named agent. Example:

```
User: "I want an agent that takes a coin node and
       searches PCGS and NGC for its current value"

AI:   "Got it. I'll create a 'Coin Valuator' agent.
       It will read the coin's denomination, year, mint mark,
       and grade, then search for current market values.
       Shall I save this as an agent you can run on any coin?"
```

### 8.2 Agent Execution Environment

Each agent run:
- Receives a subgraph context: the target node + N hops of relationships (default: 2 hops)
- Has read access to node properties and blob bodies within its context
- Can write back to the graph: create nodes, create edges, update properties
- All writes are logged on the `AGENT_RUN` node
- Cannot access nodes outside its context window without explicit user permission
- API calls go through the backend (never directly from the browser)

### 8.3 MCP Compatibility

The agent runner is designed to be MCP-compatible from day one. Agent tools are defined as MCP tool schemas. This means any MCP-compatible tool or server can be wired in as an agent capability without architecture changes.

### 8.4 Failure Handling

All failures are surfaced to the user with:
- A `🚨 Failed` visual indicator on the task tile
- A plain-English description of what went wrong
- The options: Retry / Modify (edit the task before retrying) / Take Over (assign to human)
- The partial output (if any) preserved on the `AGENT_RUN` node for reference

---

## 9. Search System

### 9.1 Three Search Modes

Search operates in three modes, all accessible from one search bar. The mode is inferred from input or selectable via a toggle.

#### Mode 1 — Fast Text Search

- Instant results as user types (no enter required)
- Searches: node labels, all property string values, blob body content
- Powered by Memgraph full-text search index
- Target: results in under 100ms
- Results stream in as they arrive

#### Mode 2 — Structured Property Search

A filter panel (activated by a filter icon next to the search bar) for precise queries:

```
Type:       [Coin ▼]
Grade:      [MS63 ▼] or higher
Country:    [United States]
Created:    [January 2025] to [March 2025]
Has body:   [Yes]
```

Filters combine with AND logic. Results update live as filters are added.

#### Mode 3 — Natural Language Graph Search

User types a question in plain English. The AI interprets it, generates a Cypher query, executes it, and returns results. The generated query is shown to the user for transparency.

Examples:

```
"What was I working on last March?"
→ Cypher: MATCH (t:Task)-[:LINKED_TO]->(d:Day)
          WHERE d.date >= '2025-03-01' AND d.date <= '2025-03-31'
          RETURN t ORDER BY t.updated_at DESC

"Everything connected to the Morgan coin collection"
→ Cypher: MATCH (f {label: 'Morgan Collection'})-[*1..3]-(n)
          RETURN DISTINCT n LIMIT 50

"Tasks blocked by something assigned to Sarah"
→ Cypher: MATCH (t:Task)-[:BLOCKED_BY]->(b:Task)-[:ASSIGNED_TO]->(p:Person)
          WHERE p.name CONTAINS 'Sarah'
          RETURN t
```

**AI subgraph principle:** The AI for search never scans the full graph. It generates a Cypher query and Memgraph executes it efficiently via its native indexes and traversal engine.

### 9.2 Search UI

```
┌─────────────────────────────────────────────────────────────┐
│  🔍  everything connected to the Morgan collection      🔧  │
├─────────────────────────────────────────────────────────────┤
│  Interpreted as: Graph search · 3 hops from CoinFolder      │
│  Query: MATCH (f {label:'Morgan...'})... [show full query]  │
├─────────────────────────────────────────────────────────────┤
│  📀 1921 Morgan Silver Dollar         Coin · MS63           │
│     In: Morgan Collection · Owned by: Jason                 │
│                                                             │
│  📄 Morgan Dollar Research Notes      Note · Apr 2024       │
│     References: 3 coins                                     │
│                                                             │
│  🌐 PCGS Morgan Value Guide           URL                   │
│     Referenced by: 5 coins                                  │
│                                                             │
│  ✅ Photograph entire Morgan set      Task · Done           │
│     Completed: March 2024                                   │
└─────────────────────────────────────────────────────────────┘
```

Results are grouped by node type when there are many. Each result shows type icon, label, key properties, and most relevant relationships in context.

### 9.3 Search Quality Rules

- **No dead ends.** Zero results always shows an AI-generated suggestion for reformulation
- **Search history.** Last 20 searches saved as quick-access list
- **Saved searches become views.** Any search can be pinned to the sidebar as a named view
- **Relevance ranking.** Text match score + relationship count + recency combined
- **Body content search.** Full-text index covers blob bodies, not just properties

---

## 10. UI Architecture

### 10.1 Layout

```
┌──────────────────┬──────────────────────────────────────────┐
│  SIDEBAR (240px) │  MAIN CANVAS                             │
│                  │                                          │
│  🏠 Home         │  (changes based on selected view)        │
│  📥 Inbox        │                                          │
│  🔔 Active   [3] │                                          │
│  📅 Today        │                                          │
│  🔍 Search       │                                          │
│  ──────────────  │                                          │
│  SAVED VIEWS     │                                          │
│  My Work         │                                          │
│  Coin Collection │                                          │
│  ──────────────  │                                          │
│  TYPES           │                                          │
│  📀 Coin    47   │                                          │
│  👤 Person  31   │                                          │
│  📋 Project 12   │                                          │
│  ✅ Task   184   │                                          │
│  + New Type      │                                          │
│  ──────────────  │                                          │
│  ⚙️ Settings     │                                          │
└──────────────────┴──────────────────────────────────────────┘
```

### 10.2 Interaction Principles

- **Mouse-first.** All actions are accessible by mouse. No mouse-trap patterns.
- **Keyboard shortcuts.** Available for all common actions. Never required.
- **Fast.** Every interaction that can be under 100ms should be. Perceived performance matters more than actual performance.
- **Non-technical language.** No database terms, no graph terms in the UI. "Connect" not "create edge." "Type" not "schema." "Related items" not "adjacent nodes."
- **Progressive disclosure.** Simple view by default. Complexity revealed only when the user asks for it.

### 10.3 Node Creation — Three Entry Points

All three converge on the same creation experience, pre-populated differently:

**From Inbox** — type raw text, classify after
**From a relationship field** — "Add coin to this folder" → opens creation panel pre-typed as Coin
**From sidebar type list** — click type → "+ New Coin" → opens creation panel

Creation panel:
```
┌─────────────────────────────────────────────────────────┐
│  New Coin                                               │
├─────────────────────────────────────────────────────────┤
│  Name/Title  [                                        ] │
│                                                         │
│  Denomination [ ]   Year [ ]   Country [ ]             │
│  Mint Mark    [ ]   Grade [ ▼] Type    [ ]             │
│  Purchase $   [ ]   Current $  [ ]                     │
│                                                         │
│  For Sale  ○ Yes  ● No                                  │
│                                                         │
│  Photo  [+ Add image]                                   │
│                                                         │
│  Relationships                                          │
│  In folder → [search or create...]                      │
│  Owned by  → [search or create...]                      │
│                                                         │
│  [+ Add relationship]                                   │
│                                                         │
│              [ Cancel ]  [ Create Coin ]                │
└─────────────────────────────────────────────────────────┘
```

**Person auto-resolution:** When a user types a name in a relationship field pointing to Person, the system searches existing Person nodes first and suggests matches. If no match, it offers to create a new Person node in one click.

---

## 11. Views

### 11.1 Home — The Control Tower

The primary landing view. Not a list of everything — a curated dashboard of what needs attention now.

```
┌─────────────────────────────────────────────────────────────┐
│  🔔 NEEDS YOU  (3)                                          │
│  ─────────────────────────────────────────────────────────  │
│  [Summarize Q3 Guide]    Agent needs: Which sections?       │
│  [Draft investor memo]   Agent needs: Approve outline       │
│  [Research competitors]  🚨 Agent failed: Rate limit hit    │
│                                                             │
│  👁️ READY TO REVIEW  (2)                                    │
│  ─────────────────────────────────────────────────────────  │
│  [Weekly status draft]   Agent complete · 2 min read        │
│  [Coin valuation report] Agent complete · 4 items found     │
│                                                             │
│  🤖 AGENTS RUNNING  (4)                                     │
│  ─────────────────────────────────────────────────────────  │
│  [LinkedIn research]     Step 2 of 4 · ~3 min remaining     │
│  [Meeting notes]         Processing...                      │
│  [Budget analysis]       Waiting on external data           │
│  [Email drafts]          Running                            │
│                                                             │
│  TODAY                                                      │
│  ─────────────────────────────────────────────────────────  │
│  ✅ Call accountant re: Q2                  Due today        │
│  ✅ Review coin purchase offer              Due today        │
│  📄 Weekly planning note                   Created today     │
└─────────────────────────────────────────────────────────────┘
```

### 11.2 Inbox — Quick Capture

Single-minded purpose: get things in without friction.

```
┌─────────────────────────────────────────────────────────────┐
│  + Capture anything...                               [↵]    │
├─────────────────────────────────────────────────────────────┤
│  UNPROCESSED  (7)                                           │
│  ─────────────────────────────────────────────────────────  │
│  ⬡ Call Dr Peterson about knee on Friday                    │
│    AI suggests: Task · Due Friday · Person: Dr Peterson     │
│    [ Convert ]  [ Leave as-is ]                             │
│                                                             │
│  ⬡ 1921-D Morgan MS63 at Springfield show - $185           │
│    AI suggests: Coin node                                   │
│    [ Convert ]  [ Leave as-is ]                             │
│                                                             │
│  ⬡ Interesting article about numismatics                   │
│    AI suggests: URL or Note                                 │
│    [ Convert ]  [ Leave as-is ]                             │
└─────────────────────────────────────────────────────────────┘
```

- Capture box is always focused when Inbox is open
- Enter key saves immediately, no confirmation needed
- AI parses captures passively and suggests types — never blocks submission
- Suggestions appear below each item, not in a modal

### 11.3 Active — Everything in Flight

The bouncing model view. All tasks with agent involvement, grouped by state.

Tiles pulse/shift position when state changes. A `🔔 Needs You` tile moves to the top of its group and gets a colored border. No popup notifications.

### 11.4 Today — The Daily Note

The current DAY node rendered as a full page:

```
┌─────────────────────────────────────────────────────────────┐
│  📅 Monday, April 6, 2026                                   │
│                                                             │
│  [Rich text area — free-form notes for today]               │
│  Type anything here...                                      │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  DUE TODAY                                                  │
│  ✅ Call accountant                                         │
│  ✅ Review coin offer                                       │
│                                                             │
│  COMPLETED TODAY                                            │
│  ✅ Photograph Morgan set                                   │
│                                                             │
│  CREATED TODAY                                              │
│  📀 1921-D Morgan Silver Dollar                             │
│  📄 Weekly planning note                                    │
│  🌐 PCGS Morgan research                                    │
└─────────────────────────────────────────────────────────────┘
```

All sections are automatically populated from the graph. The user only writes in the free-form area at the top.

### 11.5 Search

Described in full in Section 9.

### 11.6 Saved Views

Any search can be pinned as a named view in the sidebar. Views are also created from type-filtered browsing (e.g., "All Coins" is a view, "Morgan Collection" is a view derived from a folder node).

Views are stored as `ROUTING_RULE`-style metadata: a saved Cypher query + display preferences (sort, group by, columns).

---

## 12. Node View

The universal detail panel. Every node type opens in the same structural layout. Consistency is critical for learnability.

```
┌─────────────────────────────────────────────────────────────┐
│  📀 COIN                                      v2  [ Edit ]  │
│  1921 Morgan Silver Dollar                                  │
│                                      [ 🤖 AI Actions ▼ ]   │
├─────────────────────────────────────────────────────────────┤
│  PROPERTIES                                                 │
│  Denomination   $1              Year         1921           │
│  Country        United States   Mint Mark    D (Denver)     │
│  Grade          MS63            Type         Morgan Dollar  │
│  Purchase $     $185.00         Current $    $220.00        │
│  For Sale       No              Photo        [thumbnail]    │
├─────────────────────────────────────────────────────────────┤
│  RELATIONSHIPS                                              │
│  In folder →    [Morgan Collection]                         │
│  Owned by →     [Jason Smith]                               │
│  Purchased on → [March 15, 2024]                            │
│  Related to →   [1921-D Morgan Research Note]               │
│                                                             │
│  [+ Add relationship]                                       │
├─────────────────────────────────────────────────────────────┤
│  BODY                                            [ Edit ]   │
│  Purchased at the Springfield coin show. Seller             │
│  was motivated. Has a slight cheek hit but                  │
│  exceptional luster for the grade...                        │
│  [continues as rich text]                                   │
├─────────────────────────────────────────────────────────────┤
│  ACTIVITY                                                   │
│  Apr 6   Value updated by Coin Valuator agent               │
│  Mar 15  Node created by user                               │
├─────────────────────────────────────────────────────────────┤
│  AI ACTIONS                                                 │
│  [ Summarize ]  [ Research value ]  [ Find related ]        │
│  [ Run agent... ]                                           │
└─────────────────────────────────────────────────────────────┘
```

### Node View Rules

- Four consistent sections on every node: Properties, Relationships, Body, Activity
- AI Actions adapt to node type (Coin gets "Research value"; Task gets "Draft subtasks")
- Relationships show as linked chips — click any to open that node
- Body section only appears if `has_body = true` or user clicks "Add notes"
- Activity log is append-only, always visible
- Edit mode toggles inline — no separate edit page

---

## 13. Graph Visualization

### 13.1 Access

Graph view is accessed via a "View Graph" button on any node or from the sidebar. It is not the default view — it is the "see the whole picture" escape hatch.

### 13.2 Rendering

Built with D3.js. Force-directed layout by default.

**Node rendering:**
- Size proportional to connection count (more connections = larger node)
- Color and icon driven by type (configurable per type in type registry)
- Label shows node's display name
- Hover shows a mini property summary

**Edge rendering:**
- Line style driven by relationship type (solid, dashed, dotted)
- Thickness driven by relationship weight (if set)
- Direction shown by arrowhead
- Hover shows edge type and properties

### 13.3 Interaction

- **Click node** → opens node view in a side panel alongside the graph
- **Drag node** → repositions it; layout is saved per view
- **Scroll** → zoom in/out
- **Pan** → click and drag on empty canvas
- **Create relationship** → hold Shift + drag from one node to another → edge type picker appears
- **Filter** → filter panel to show only certain node types or relationship types
- **Depth control** → slider to control how many hops from the focal node are shown (1–5)
- **Focus** → double-click a node to re-center the graph on it

### 13.4 Performance

D3 force simulation can degrade with large graphs. Mitigations:

- Default: show only nodes within 2 hops of focal node
- Maximum rendered nodes: 200 (configurable)
- Beyond 200 nodes: show summary clusters by type with drill-down
- WebGL rendering (via regl or similar) as a future optimization if needed

---

## 14. Notification & Interruption Model

### 14.1 Principles

- Agents do not interrupt the user's flow
- Notifications are visual state changes, not popups or sounds
- The user checks in when ready — the app makes the state obvious at a glance

### 14.2 Badge

The sidebar "Active" item shows a badge count of tasks in `needs_you` or `failed` state only. Tasks in `needs_review` or `agent_complete` are shown in the badge only if the user has been away for more than 30 minutes (configurable).

```
🔔 Active   [3]    ← 3 tasks need the user
```

### 14.3 Tile Behavior

In the Active view, tiles shift position and change visual state when updated:
- `needs_you` → moves to top of its group, gets an amber left border
- `failed` → gets a red left border and a 🚨 indicator
- `agent_complete` → gets a green left border
- State transitions animate smoothly (200ms ease)

### 14.4 No Desktop Notifications

Desktop OS notifications are not used in v1. The app's visual state is the notification system. This keeps the experience calm and non-intrusive.

---

## 15. Schema Versioning

### 15.1 Version Model

Every type has a version number. When a user modifies a type (adds, removes, or renames fields), a new version is created. Old nodes retain their version number.

Every node stores `type_version: INT`. Queries that return nodes of mixed versions handle missing fields gracefully (show blank, not error).

### 15.2 Migration Flow

When a type is updated, the user is prompted:

```
You've updated the Coin type (v1 → v2).
You have 47 existing coins on version 1.

New fields added:
  + Current Value (currency)
  + Provenance (short text)

What should happen to existing coins?

  ○ Leave them on v1 — they'll still work fine
  ○ Upgrade all to v2 — new fields will be blank
  ○ Upgrade all to v2 — set defaults:
      Current Value → $0.00
      Provenance    → "Unknown"

[ Apply ]
```

### 15.3 Version History

Every type's version history is stored as a chain of `SCHEMA_VERSION` nodes linked by `PRECEDED_BY` edges. Viewing version history is accessible from the type registry.

### 15.4 Breaking Changes

Removing a field is a breaking change. The system warns:

```
⚠️ Removing "Grade" will delete that data from all 47 Coin nodes.
This cannot be undone. Are you sure?

[ Cancel ]  [ Yes, remove Grade from all coins ]
```

Renaming a field is non-breaking — data is preserved, only the display name changes.

---

## 16. Storage & Blob Architecture

### 16.1 Memgraph Data

Memgraph stores all graph data (nodes, edges, properties) in its native format under `/data/memgraph/`. This directory is managed by the Memgraph Docker container and mounted as a Docker volume for persistence.

Backup: copy the `/data/memgraph/` directory while Memgraph is stopped.

### 16.2 Blob Store

Node body content is stored as files on the local filesystem. Structure:

```
/data/blobs/
  a3/
    a3f8c2d1-4e5b-6c7d-8e9f-0a1b2c3d4e5f/
      body.json          ← TipTap/ProseMirror JSON
  b7/
    b7c1a3e9-2d4f-6e8a-0b2c-4d6e8f0a2b4c/
      body.json
  f2/
    f2d8b1c4-6e0a-2c4e-8f0a-2b4c6e8f0a2b/
      body.json
```

**Two-level prefix structure:** The first two characters of the node UUID become the subdirectory. This caps any single directory at ~400 entries regardless of total node count. Lookup is O(1) — always derive the path from the node ID directly.

**File format:** TipTap JSON. Portable, rich, and readable by the editor without conversion. Alternative bodies (e.g., imported Markdown) are converted to TipTap JSON on import.

### 16.3 File Attachments

Files attached to nodes (images, PDFs, etc.) are stored under:

```
/data/files/
  {node_id[0:2]}/
    {node_id}/
      {original_filename}
```

The `FILE` node in the graph stores the path, MIME type, and size. The actual file is never duplicated in the graph.

### 16.4 Portability

To move the entire system:
1. Stop the app (`./stop.sh`)
2. Copy the project directory (includes `/data/`, docker-compose.yml, backend code, frontend build)
3. On the new machine: `./start.sh`

No export/import step. No format conversion. The data directory is the database.

---

## 17. Settings & Configuration

### 17.1 .env File

The `.env` file in the project root stores all configuration. Users never edit this directly — the Settings UI writes to it.

```env
# AI Configuration
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-opus-4-5
AI_MAX_TOKENS_PER_REQUEST=4000
AI_MONTHLY_WARNING_THRESHOLD_USD=10.00

# Claude Code Integration
CLAUDE_CODE_ENABLED=false
CLAUDE_CODE_SKILLS_PATH=

# Memgraph
MEMGRAPH_HOST=localhost
MEMGRAPH_PORT=7687
MEMGRAPH_USERNAME=
MEMGRAPH_PASSWORD=

# Application
APP_PORT=3000
DATA_DIR=./data
BLOB_DIR=./data/blobs
FILES_DIR=./data/files
```

### 17.2 Settings UI Sections

**AI & Agents**
- API key input (masked)
- Model selection
- Monthly token usage display
- Warning threshold setting
- Claude Code integration toggle + path

**Routing Rules**
- List of all learned routing rules
- Per-rule: pattern description, executor, mode (suggest/always), hit count
- Edit or delete any rule

**Type Registry**
- All types (built-in and user-defined)
- Per-type: field list, version, node count, version history
- Edit fields, add fields, view migration history

**Data & Backup**
- Data directory path
- Manual backup button (copies `/data/` to a timestamped zip)
- Import data from zip

**Appearance**
- Light / dark mode
- Sidebar width
- Default view on launch

---

## 18. Project Structure

```
project-root/
├── docker-compose.yml          ← starts Memgraph + backend together
├── start.sh                    ← one-command startup (Mac/Linux)
├── start.bat                   ← one-command startup (Windows)
├── stop.sh
├── .env                        ← config (written by Settings UI)
├── .env.example                ← template for first-time setup
│
├── backend/                    ← FastAPI Python server
│   ├── main.py                 ← app entry point, route registration
│   ├── requirements.txt
│   ├── config.py               ← loads .env
│   ├── db/
│   │   ├── connection.py       ← Memgraph connection pool
│   │   ├── queries.py          ← Cypher query library
│   │   └── seed.py             ← initializes built-in types on first run
│   ├── models/
│   │   ├── node.py             ← Pydantic models for nodes
│   │   ├── edge.py             ← Pydantic models for edges
│   │   └── types.py            ← type definition models
│   ├── routers/
│   │   ├── nodes.py            ← CRUD for nodes
│   │   ├── edges.py            ← CRUD for edges
│   │   ├── types.py            ← type registry CRUD
│   │   ├── search.py           ← search endpoints (text, structured, NL)
│   │   ├── agents.py           ← agent runner endpoints
│   │   ├── ai.py               ← AI routing, schema assist, NL search
│   │   └── settings.py         ← read/write .env settings
│   ├── agents/
│   │   ├── runner.py           ← agent execution engine
│   │   ├── builtin/
│   │   │   ├── summarizer.py
│   │   │   ├── researcher.py
│   │   │   ├── email_drafter.py
│   │   │   └── node_linker.py
│   │   └── user_defined/       ← user-created agent templates stored here
│   ├── blob/
│   │   └── store.py            ← read/write blob files by node ID
│   └── tests/
│
├── frontend/                   ← React + Vite
│   ├── package.json
│   ├── vite.config.js
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── api/                ← API client functions (fetch wrappers)
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.jsx
│   │   │   │   └── MainCanvas.jsx
│   │   │   ├── nodes/
│   │   │   │   ├── NodeView.jsx          ← universal node detail panel
│   │   │   │   ├── NodeCard.jsx          ← compact card for lists
│   │   │   │   ├── NodeCreatePanel.jsx   ← creation form
│   │   │   │   └── RelationshipChip.jsx
│   │   │   ├── graph/
│   │   │   │   └── GraphView.jsx         ← D3 force graph
│   │   │   ├── search/
│   │   │   │   ├── SearchBar.jsx
│   │   │   │   ├── SearchResults.jsx
│   │   │   │   └── FilterPanel.jsx
│   │   │   ├── agents/
│   │   │   │   ├── TaskCard.jsx          ← task with agent thread
│   │   │   │   ├── AgentSummary.jsx
│   │   │   │   └── AgentThread.jsx
│   │   │   └── common/
│   │   │       ├── RichTextEditor.jsx    ← TipTap wrapper
│   │   │       ├── Badge.jsx
│   │   │       └── Modal.jsx
│   │   ├── views/
│   │   │   ├── HomeView.jsx
│   │   │   ├── InboxView.jsx
│   │   │   ├── ActiveView.jsx
│   │   │   ├── TodayView.jsx
│   │   │   └── SearchView.jsx
│   │   └── stores/             ← React context / Zustand state
│   │       ├── nodeStore.js
│   │       ├── typeStore.js
│   │       └── agentStore.js
│
└── data/                       ← all user data (gitignored)
    ├── memgraph/               ← Memgraph storage (Docker volume mount)
    ├── blobs/                  ← node body content
    └── files/                  ← file attachments
```

---

## 19. Build & Run

### 19.1 Prerequisites

- Docker Desktop (for Memgraph)
- Python 3.11+
- Node.js 20+

### 19.2 First-Time Setup

```bash
# Clone the repo
git clone <repo-url>
cd project-root

# Copy environment template
cp .env.example .env

# Edit .env to add your Anthropic API key
# (or use Settings UI after first launch)

# Start everything
./start.sh
```

`start.sh` does:
1. `docker-compose up -d` (starts Memgraph)
2. `pip install -r backend/requirements.txt`
3. `python backend/db/seed.py` (initializes built-in types, idempotent)
4. `uvicorn backend.main:app --reload` (starts FastAPI)
5. `cd frontend && npm install && npm run dev` (starts Vite dev server)
6. Opens `http://localhost:3000` in default browser

### 19.3 Daily Use

```bash
./start.sh    # start
./stop.sh     # stop (also stops Memgraph container)
```

### 19.4 Production Build

For a faster, non-dev local build:

```bash
cd frontend && npm run build    # builds to frontend/dist/
# FastAPI serves the built frontend as static files
./start-prod.sh
```

---

## 20. Implementation Phases

### Phase 1 — Graph Foundation (No AI)

**Goal:** Prove the data model. You can capture, type, link, and retrieve.

- [ ] Docker Compose with Memgraph running locally
- [ ] FastAPI backend with Memgraph connection
- [ ] Seed script for all built-in types
- [ ] Node CRUD API (create, read, update, delete)
- [ ] Edge CRUD API
- [ ] Type registry API (list, create, read user-defined types)
- [ ] Blob store (read/write body files)
- [ ] React frontend scaffold (Vite, routing, sidebar layout)
- [ ] Inbox view (capture + display inbox items)
- [ ] Node view (display properties, relationships, body)
- [ ] Node creation panel (all three entry points)
- [ ] Today view (current day node + linked items)
- [ ] Basic text search (Memgraph full-text index)

**Done when:** You can add a Coin, link it to a CoinFolder, write notes in its body, and find it via search.

### Phase 2 — Schema & Type System

**Goal:** User-defined types feel natural. Schema versioning works.

- [ ] Type definition UI (AI-assisted creation flow)
- [ ] Dynamic form generation from type definitions
- [ ] Schema versioning (version bump on type edit)
- [ ] Migration UI (upgrade existing nodes to new version)
- [ ] Label system (temporary labels + AI pattern detection)
- [ ] Type registry UI (list, view, edit types)
- [ ] Inheritance (one level, enforced)
- [ ] Relationship type definition (user-defined edge types)

**Done when:** You can define a Coin type via conversation, create coins, add a new field, and migrate existing coins.

### Phase 3 — Search

**Goal:** Search feels fast and powerful.

- [ ] Full-text search with sub-100ms response
- [ ] Structured filter panel
- [ ] Natural language search (AI → Cypher → results)
- [ ] Show generated Cypher query to user
- [ ] Search history
- [ ] Saved searches as sidebar views
- [ ] No dead ends (zero-result suggestions)
- [ ] Result grouping by type

**Done when:** Natural language queries return correct results with the Cypher shown.

### Phase 4 — AI Routing & Agents

**Goal:** Tasks route to agents, bounce back correctly, and the learning loop works.

- [ ] Task state machine (all states implemented)
- [ ] Routing analysis API (evaluates task → returns routing suggestion)
- [ ] Agent runner (executes agents, writes back to graph)
- [ ] Built-in agents (summarizer, researcher, email drafter, node linker)
- [ ] Agent complete summary UI
- [ ] Needs You interruption model (tile animation, badge)
- [ ] Routing rules (create, apply, edit, delete)
- [ ] Learning loop (always-route approval flow)
- [ ] Token cost estimation and tracking
- [ ] Failure handling (no silent failures, retry UI)
- [ ] Active view (control tower)
- [ ] Home view (control tower summary)

**Done when:** A task is assigned to the summarizer agent, it runs, returns a summary, and you can approve it or ask it to redo.

### Phase 5 — Graph Visualization

**Goal:** The D3 graph view is interactive and genuinely useful.

- [ ] Force-directed graph rendering (D3)
- [ ] Node type icons and colors
- [ ] Edge type styling
- [ ] Click node → open node view in side panel
- [ ] Shift+drag to create relationship between nodes
- [ ] Depth slider
- [ ] Filter by node/edge type
- [ ] Performance cap at 200 nodes with cluster summary beyond

**Done when:** You can see your full coin collection as a graph and draw a new relationship between two nodes visually.

### Phase 6 — Polish & Settings

**Goal:** The system is pleasant to use every day.

- [ ] Settings UI (all sections)
- [ ] Keyboard shortcuts throughout
- [ ] Dark/light mode
- [ ] Claude Code integration (detect + surface skills as agents)
- [ ] User-defined agents (AI generates prompt template from description)
- [ ] Mobile capture (v2 — not in v1 scope, document the API contract)
- [ ] Backup / restore UI
- [ ] Onboarding flow (first launch, API key setup, first type creation)

---

## Appendix A — Key Design Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Graph DB | Memgraph | Active OSS, Cypher, in-memory speed, persistence, AI integrations |
| No Tauri/Electron | Local web app | Simpler build, easier Claude Code iteration, portable by folder copy |
| No tags | Labels (temporary) | Graph makes tags redundant; labels are training wheels toward types |
| No workspaces | One unified graph + views | Simpler; cross-domain connections just work |
| Loose ontology | Any node links to any node | User reality doesn't respect clean schemas |
| Dates as nodes | Temporal node types | Free timeline traversal; "show me everything in March" is just a graph walk |
| AI subgraph only | Never full graph scan | Performance and cost; AI uses indexes and targeted traversal |
| Blob by node ID prefix | Two-level directory | O(1) lookup, max ~400 files per directory at any scale |
| Person auto-resolve | Search first, create if no match | Prevents duplicate Person nodes naturally |
| One inheritance level | Enforced by AI warning | Deeper hierarchies become unmaintainable |
| No silent failures | All agent failures surfaced | User trust requires transparency |
| No desktop notifications | Visual state only | Calm, non-intrusive, respects flow |

---

## Appendix B — Cypher Query Examples

### Get a node with all its relationships
```cypher
MATCH (n {id: $node_id})
OPTIONAL MATCH (n)-[r]-(m)
RETURN n, collect({rel: r, node: m}) as relationships
```

### Get today's linked items
```cypher
MATCH (d:Day {date: $today})
OPTIONAL MATCH (n)-[:LINKED_TO|DUE_ON|COMPLETED_ON]->(d)
RETURN d, collect(n) as items
```

### Full-text search across all nodes
```cypher
CALL db.idx.fulltext.search("nodeIndex", $query)
YIELD node, score
RETURN node, score ORDER BY score DESC LIMIT 20
```

### Find everything within N hops of a node
```cypher
MATCH (n {id: $node_id})-[*1..$hops]-(related)
RETURN DISTINCT related LIMIT 200
```

### Tasks in a date range
```cypher
MATCH (t:Task)-[:DUE_ON]->(d:Day)
WHERE d.date >= $start AND d.date <= $end
RETURN t ORDER BY d.date ASC
```

### Nodes sharing a relationship target (e.g., same owner)
```cypher
MATCH (a)-[:OWNED_BY]->(p:Person {name: $name})<-[:OWNED_BY]-(b)
WHERE a.id <> b.id
RETURN a, b, p
```

---

*End of Design Document*
