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

Migrations are raw SQL files in `glyph-backend/migrations/` (numbered). Apply them in order against the Supabase project; there is no in-repo migration runner.

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
`glyph-backend/context.py` builds the message list each LLM is allowed to see. An invited LLM:
- Only sees user messages if it has a connection with `target_type='user'`.
- Only sees other LLMs' messages if connected to those specific LLMs.
- Always sees its own past messages (rendered as `AIMessage`).
- Other connected LLMs' messages are passed in as `HumanMessage` prefixed with the sender's display name.

Any change to LLM-visible context flows through this module — do not bypass it from agent code.

### Streaming pattern (`/askLLM`)
`agents/chat_agent.py` builds a LangGraph agent via `langchain.agents.create_agent` and bridges `astream_events(version="v2")` to the SSE wire format the frontend expects:
```
{type: "token", content}
{type: "tool", name}
{type: "done", message_id, content}
{type: "error", detail}
```
The final assistant message row is INSERTed into Supabase by `chat_agent.py` itself (not by the agent graph), so the realtime push to other participants fires at the moment the reply is complete. When `replace_message_id` is set, the agent regenerates that row in place: context is truncated to messages strictly before it, and the result is UPDATEd onto the existing row.

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
From `main.py`:
- `config.py` — env loading, OpenAI/Supabase/JWKS clients, LangSmith setup.
- `auth.py` — `get_current_user` (JWT via JWKS) and `verify_participant` (chat membership check). Every protected route calls both.
- `schemas.py` — pydantic request/response models.
- `context.py` — see "llm_connections" section above.
- `tools.py` — `@tool`-decorated functions bound to the agent at graph build time. Tools currently don't need per-request context; if a future tool does, plumb it via `create_agent`'s `context_schema=` parameter.
- `agents/chat_agent.py` — streaming chat reply (LangGraph).
- `agents/planner_agent.py` — one-shot planner; uses `with_structured_output(PlannerResponse)` so output is guaranteed valid JSON.
- `agents/join_agent.py` — generates the welcome message when an LLM joins.
- `invitations.py` — invite endpoints (mounted as a router).

### Auth flow
Frontend stores the Supabase session client-side. `apiFetch` in `src/services/supabase.js` automatically attaches `Authorization: Bearer <access_token>` to backend calls. The backend verifies the JWT via Supabase JWKS and looks up `chat_participants` to confirm membership before any chat-scoped operation.

### Env files
- `glyph-frontend/.env` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_BACKEND_URL`.
- `glyph-backend/.env` — OpenAI key, Supabase service-role key + URL, LangSmith config, `CORS_ORIGINS`, `PUBLIC_API_BASE`.

LangSmith tracing is wired via `setup_tracing()` in `config.py`; every agent run lands in LangSmith automatically when the env vars are set.

## Feature delivery workflow (per Jira task)

When the user describes a feature and gives a Jira task key (e.g. `KAN-5`), run this
process after the implementation is complete and verified:

1. **Document** the feature as Markdown at `docs/features/<KEY>-<short-slug>.md`
   (e.g. `docs/features/KAN-5-llm-delegation.md`). One file per task. The doc
   should cover: what the feature does, why, the key files/functions touched,
   how it works end-to-end, any config/DB/migration steps, and how to test it.
2. **Attach the doc to the Jira task** via the Atlassian MCP — upload the `.md`
   file as an attachment on the issue (preferred). If attachment isn't possible,
   fall back to adding it as a comment on the issue. Always confirm which issue
   key before posting.
3. **Push the code** referencing the task: work on a branch named `<KEY>-<slug>`,
   prefix the commit subject with the key (`KAN-5: ...`), and push to `origin`.
   The key in the branch/commit is what links the work back to the Jira task.
   Open a PR only when the user asks.

Notes:
- Jira access is via the **Atlassian Remote MCP** server (set up once with
  `claude mcp add`). If the MCP tools aren't available in a session, tell the
  user rather than skipping the upload silently.
- Don't push or post to Jira unless the user has given the task key for the
  current work — these are outward-facing actions.
