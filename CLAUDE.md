# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Frontend** (`glyph-frontend/`):
```bash
npm run dev      # Vite dev server (default port 5173)
npm run build    # Production build (also doubles as a typecheck-via-bundle)
npm run lint     # ESLint
```

**Backend** (`glyph-backend/`):
```bash
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

There is no test runner configured in either service.

Migrations are **not** in this repo. They live as numbered `## NNNN_name.sql` sections in the Dendron note `projects.glyph.backend.sql_migrations.md` (under `notes/dendron-notes/`). When a feature needs a schema change, append a new numbered section there (mirror the closest existing one — e.g. `0010_memories_pgvector.sql` for pgvector tables), and the user applies it manually in the Supabase SQL editor. There is no in-repo migration runner.

## Architecture

### Two-service split
- React 19 + Vite + Tailwind v4 frontend (`glyph-frontend/`).
- FastAPI backend (`glyph-backend/`).
- Supabase provides auth, Postgres, and realtime — used directly from the frontend for reads/writes/subscriptions, and from the backend for privileged operations and LLM-context queries.

### Multi-LLM chat semantics
A chat has multiple participants: humans (`profiles` / `chat_participants`) and LLMs (`invited_llms`). Messages have `sender_type ∈ {user, llm}` plus `sender_user_id` or `sender_llm_id`. Mentioning `@SomeModel` triggers `/askLLM`, which streams that LLM's reply back as SSE.

Important message flags that affect both UI and LLM context:
- `deleted_at` — soft delete; UI shows a tombstone, LLMs see no trace.
- `included_in_context: false` — "side ask" message; hidden from the LLM's context unless explicitly included.
- `side_parent_message_id` — links a side-ask thread to its parent.

### `llm_connections` is the visibility model (the key non-obvious piece)
`glyph-backend/agents/context_builder.py` (`build_context_messages`) builds the message list each LLM is allowed to see. An invited LLM:
- Only sees user messages if it has a connection with `target_type='user'`.
- Only sees other LLMs' messages if connected to those specific LLMs.
- Always sees its own past messages (rendered as `AIMessage`).
- Other connected LLMs' messages are passed in as `HumanMessage` prefixed with the sender's display name.

Any change to LLM-visible context flows through this module — do not bypass it from agent code.

### Streaming pattern (`/askLLM`)
`agents/agent.py` (`run_agent_stream`) builds a hand-rolled LangGraph (`_build_graph`) and bridges `astream_events(version="v2")` to the SSE wire format the frontend expects:
```
{type: "token",       llm_id, content}
{type: "tool",        llm_id, name}
{type: "agent_start", llm_id, from_llm_id, delegation_message_id}   # a delegated LLM is starting
{type: "done",        llm_id, message_id, content}
{type: "error",       llm_id, detail}
```
The final assistant message row is INSERTed into Supabase by `agent.py` itself (not by the agent graph), so the realtime push to other participants fires at the moment the reply is complete. When `replace_message_id` is set, the agent regenerates that row in place: context is truncated to messages strictly before it, and the result is UPDATEd onto the existing row.

### Agent graph shape (`agents/agent.py::_build_graph`)
A ReAct loop with a nested RAG subgraph:
- Nodes: `agent` (LLM with `bind_tools`), `tools` (`ToolNode`), `retrieve` (the compiled RAG subgraph — see below).
- Routing after `agent`: a `retrieve_documents` tool call → `retrieve`; any other tool call → `tools`; no tool call → END. `tools → agent`, `retrieve → agent`.
- `AgentState` carries `messages` (+ `operator.add`) and `chat_id` (shared with the retrieve subgraph). `agents/graph.py` exposes a module-level compiled graph for LangGraph Studio.

### File uploads (KAN-7)
Files upload **directly to Supabase Storage**, not through the backend body. The frontend `apiUpload` (`src/services/supabase.js`) calls `POST /uploads/sign` for a signed upload token, then `uploadToSignedUrl` puts the bytes straight in the `chat-uploads` bucket, and sends only the public URL to `/messages`. This avoids proxy/body-size 413s on large files. Hard ceiling is the Supabase bucket/plan file-size limit (50 MB free); keep `MAX_SIGNED_SIZE` (backend) and `MAX_UPLOAD_BYTES` (frontend) aligned with it. Legacy `POST /uploads` (through-backend) remains as a fallback.

### RAG retrieval (KAN-6) — `agents/rag/`
Corpus = uploaded files. On message-create, `api/messages.py` enqueues a `BackgroundTasks` ingest (`agents/rag/ingest.py`): extract (`read_file.extract_text`) → token-aware chunk (`chunking.py`, tiktoken) → batch-embed (`text-embedding-3-small`) → upsert into the `documents` pgvector table (dedupe on `content_hash` = record manager). Retrieval is a **nested subgraph** (`agents/rag/retrieval_graph.py`): `router → ⇉ {one node per RAG method} → fuse` (Reciprocal Rank Fusion). Methods live in `agents/rag/methods.py` (`NODE_FUNCS`, gated by `ENABLED_METHODS`). The agent enters it via the `retrieve_documents` tool, which is bound to the model but **excluded from `ToolNode`** — its execution is the subgraph node, so LangSmith/Studio render one nested graph. Vector search uses the `match_documents` RPC (mirrors `match_memories`).

### LLM→LLM delegation (KAN-5)
An LLM can hand a task to another LLM via the `delegate` tool (`agents/tools/contextual/delegate.py`), which queues a `Delegation` on `ToolContext`. After the reply is persisted, `run_agent_stream` runs queued delegations — emits `agent_start`, then streams the target's reply into the same SSE response — bounded by `MAX_DELEGATION_HOPS` (currently 1). Plain `@mentions` in an LLM's text do NOT trigger anything; only the `delegate` tool does.

### Two views per chat
The top-level `Chat.jsx` toggles between two view groups:
- **chat view** — team chat pane + workspace (LLM replies) pane + files pane.
- **planner view** — calendar + daily note + agent pane.

Planner state (notes, selected date) is per chat (`daily_notes` is keyed on `chat_id, date`). That's why `Chat.jsx` owns both — they share the same `chat_id` boundary.

### Frontend layout convention
```
glyph-frontend/src/app/
  components/
    Chat.jsx                # Top-level container; owns panel widths, view-group toggle, mention dropdown
    Icons.jsx               # All icon SVG components — add new icons here, do not inline
    chatView/
      context/              # LLMContext, UserContext (slide-out detail panels)
      invite/               # InviteLLM, InviteUser modals
      message/              # Message (user), AIMessage (LLM with markdown + code highlighting)
    plannerView/            # Calendar, DailyNote, Agent
  hooks/
    useChatMessages.js      # Loads chat metadata, messages, invitedLLMs, profiles + realtime subscription
    usePlannerNotes.js      # Loads daily_notes + realtime + updateNote mutation
  services/apis/
  utils/                    # llmColors (per-LLM accent palette), mentions, modelCatalog
```

`Chat.jsx` is large by design — the panel layout and resize/toggle logic is tightly coupled across all panes. Lift data layers into hooks; lift small reusable bits into the folders above. Don't try to split panes into standalone components — they share too much state to be worth the prop-drilling.

### Realtime subscription pattern
Always create a unique channel name per mount:
```js
const channelName = `chat-${chatId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
```
Reusing channel names breaks under React 19 strict-mode double-mount with `cannot add postgres_changes after subscribe()`. The existing hooks already do this — match the pattern.

### Backend module split
`main.py` registers routers and calls `_setup_tracing()` (LangSmith). Layout:
- `settings.py` — typed env vars (pydantic-settings). `dependencies.py` — constructed clients (`get_openai`, `get_supabase`, JWKS). `auth.py` — `get_current_user` (JWT via JWKS) + `verify_participant`; every protected route calls both.
- `api/` — routers: `ask_llm.py` (`/askLLM` streaming), `messages.py`, `chats.py`, `participants.py`, `invitations.py`, `uploads.py`, plus `schemas.py` (pydantic models).
- `usage.py` — plan limits, rate/budget gating (`check_and_gate`), token recording (`record_tokens`).
- `agents/agent.py` — all agent entry points: `run_agent_stream` (streaming chat), `run_planner` (one-shot, `with_structured_output(PlannerResponse)`), `generate_join_message` (LLM-join greeting). `agents/context_builder.py` — the `llm_connections` visibility module (see above). `agents/graph.py` — module-level graph for Studio. `agents/prompts.py` — prompt strings. `agents/providers/registry.py` — `get_model(model_type)` (Anthropic/OpenAI/Gemini) + `is_claude`.
- `agents/tools/` — tool package. `registry.py::get_tools(ctx)` assembles the toolset: `stateless/` (web_search, read_url, execute_code, read_file, create_chart, write_file, create_pdf) + `contextual/` (python_repl, query_chat, memory, delegate) which close over a `ToolContext`. Add new tools here. The `retrieve_documents` RAG tool is bound in `_build_graph` (not via `get_tools`) so it can be excluded from `ToolNode`.
- `agents/rag/` — the RAG layer (see "RAG retrieval" above).

### Auth flow
Frontend stores the Supabase session client-side. `apiFetch` in `src/services/supabase.js` automatically attaches `Authorization: Bearer <access_token>` to backend calls. The backend verifies the JWT via Supabase JWKS and looks up `chat_participants` to confirm membership before any chat-scoped operation.

### Env files
- `glyph-frontend/.env` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_BACKEND_URL`.
- `glyph-backend/.env` — OpenAI key, Supabase service-role key + URL, LangSmith config, `CORS_ORIGINS`, `PUBLIC_API_BASE`.

LangSmith tracing is wired via `_setup_tracing()` in `main.py` (gated on `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY`); every agent run lands in LangSmith automatically when those env vars are set. Note: these vars must be set on the **deployed** host too — `.env` is local-only, so production needs them configured separately or tracing silently stays off.

## Feature delivery workflow (per Jira task)

When the user describes a feature and gives a Jira task key (e.g. `KAN-5`), run this
process after the implementation is complete and verified:

1. **Document** the feature as Markdown at `docs/features/<KEY>-<short-slug>.md`
   (e.g. `docs/features/KAN-5-llm-delegation.md`). One file per task. The doc
   should cover: what the feature does, why, the key files/functions touched,
   how it works end-to-end, any config/DB/migration steps, and how to test it.
2. **Post the doc to the Jira task** via the Atlassian Remote MCP. The remote MCP
   has **no file-attachment tool** — post the doc as a **comment** on the issue
   (`addCommentToJiraIssue`, `contentFormat: "markdown"`), prefixed with the
   branch/commit refs. Always confirm the issue key before posting.
3. **Push the code** referencing the task: work on a branch named `<KEY>-<slug>`,
   prefix the commit subject with the key (`KAN-5: ...`), and push the branch to
   `origin`. The key in the branch/commit is what links the work back to the Jira
   task. Open a PR only when the user asks.
4. **Merge to `main`** (solo workflow — the user works alone): after pushing the
   branch, fast-forward/merge `<KEY>-<slug>` into `main` and push `main` to
   `origin`. Do this automatically as part of the task; no PR review needed.

Notes:
- Jira access is via the **Atlassian Remote MCP** server (set up once with
  `claude mcp add`). If the MCP tools aren't available in a session, tell the
  user rather than skipping the upload silently.
- Don't push or post to Jira unless the user has given the task key for the
  current work — these are outward-facing actions.
