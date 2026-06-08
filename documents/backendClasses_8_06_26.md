# Backend Classes — Repository Layer & Supporting Classes

All classes live in `glyph-backend/`. The backend follows a **Repository pattern**: each domain object has a dedicated class that wraps all Supabase queries. Route handlers import these classes directly — there is no ORM or shared session.

---

## Database Repositories (`database/`)

Every repository accepts an optional `client: Client` in its constructor. When omitted it calls `get_supabase()` (a cached singleton from `dependencies.py`).

---

### `ChatRepository` — `database/chats.py`

Manages `chats` and `chat_participants` tables. Also reads `profiles` for display names.

| Method | Signature | Purpose |
|--------|-----------|---------|
| `create` | `(name, created_by) → dict` | Insert a new chat row |
| `rename` | `(chat_id, name) → None` | Update the chat name |
| `get_name` | `(chat_id) → str \| None` | Fetch just the name |
| `count_owned_by_user` | `(user_id) → int` | Count chats where user is owner (plan limit check) |
| `count_human_participants` | `(chat_id) → int` | Count participant rows (teammate limit check) |
| `add_participant` | `(chat_id, user_id, role) → dict` | Insert a participant row |
| `get_participant` | `(chat_id, user_id) → dict \| None` | Look up a single participant |
| `get_participant_by_id` | `(participant_id) → dict \| None` | Look up participant by its PK |
| `list_participants_with_profiles` | `(chat_id) → list[dict]` | Join participants with profiles |
| `update_pin` | `(chat_id, user_id, pinned_at) → None` | Set or clear pinned_at |
| `remove_participant` | `(chat_id, user_id) → None` | Delete the participant row (leave chat) |
| `is_owner` | `(chat_id, user_id) → bool` | Check if user has `role='owner'` |
| `update_can_invite` | `(participant_id, can_invite) → None` | Toggle invite permission |
| `get_profile_first_name` | `(user_id) → str` | Fetch first_name from profiles |

**Used by:** `api/chats.py`, `api/participants.py`, `api/invitations.py`, `auth.py`

---

### `LLMRepository` — `database/llms.py`

Manages `invited_llms` and `llm_connections` tables.

| Method | Signature | Purpose |
|--------|-----------|---------|
| `get_by_id` | `(llm_id) → dict \| None` | Fetch a full LLM row |
| `get_chat_id` | `(llm_id) → str \| None` | Fetch just the chat_id for an LLM |
| `list_by_chat` | `(chat_id, exclude_id?) → list[dict]` | Minimal list (id + display_name) for context building |
| `list_by_chat_full` | `(chat_id) → list[dict]` | Full list ordered by display_number |
| `get_next_display_number` | `(chat_id) → int` | Max display_number + 1 for ordering |
| `create` | `(chat_id, display_name, model_instruct, model_type, display_number, invited_by) → dict` | Insert a new LLM |
| `create_connections` | `(conn_rows: list[dict]) → list[dict]` | Bulk-insert llm_connections rows |
| `get_connections` | `(llm_id) → list[dict]` | All connections for an LLM |
| `list_connections_for_llms` | `(llm_ids) → list[dict]` | Connections for a set of LLMs |
| `validate_llm_ids_in_chat` | `(chat_id, llm_ids) → set[str]` | Filter llm_ids to those that belong to the chat |

**Used by:** `api/participants.py`, `agents/agent.py`, `agents/context_builder.py`, `api/integrations/router.py`

---

### `MessageRepository` — `database/messages.py`

Manages the `messages` table.

| Method | Signature | Purpose |
|--------|-----------|---------|
| `create` | `(chat_id, sender_type, content, *, sender_user_id?, sender_llm_id?, included_in_context, attachments?, kind, side_parent_message_id?) → dict` | Generic insert |
| `create_user_message` | `(chat_id, sender_user_id, content, included_in_context, attachments) → dict` | Insert + re-fetch joined with invited_llms for frontend response shape |
| `get_by_id` | `(message_id) → dict \| None` | Fetch a single message |
| `get_created_at` | `(message_id) → str \| None` | Fetch just the timestamp (used for context truncation) |
| `list_for_context` | `(chat_id, before_created_at?) → list[dict]` | All messages oldest-first for LLM context, optionally truncated by timestamp |
| `list_by_chat` | `(chat_id, *, sender_type?, sender_llm_id?, limit) → list[dict]` | Filtered recent messages for tools |
| `update_content` | `(message_id, content, chat_id, sender_llm_id) → dict \| None` | Overwrite content (regenerate flow) |
| `edit` | `(message_id, content, edited_at) → None` | User edit — also sets edited_at |
| `soft_delete` | `(message_id, deleted_at) → None` | Soft delete — sets deleted_at |
| `update_inclusion` | `(message_ids, chat_id, included) → None` | Bulk toggle included_in_context |

**Used by:** `api/messages.py`, `api/chats.py`, `api/participants.py`, `agents/agent.py`

---

### `DailyNotesRepository` — `database/daily_notes.py`

Manages the `daily_notes` table.

| Method | Signature | Purpose |
|--------|-----------|---------|
| `list_by_chat` | `(chat_id) → list[dict]` | All notes for a chat ordered by date (used by planner agent) |

**Used by:** `agents/agent.py` (planner)

---

### `InvitationRepository` — `database/invitations.py`

Manages `chat_invitations`.

| Method | Signature | Purpose |
|--------|-----------|---------|
| `get_pending` | `(chat_id, email) → list[dict]` | Check for existing pending invite (dedup) |
| `create` | `(chat_id, email, token, invited_by, expires_at) → dict` | Insert a new invitation |
| `list_active` | `(chat_id, now_iso) → list[dict]` | All non-expired, non-accepted, non-revoked invitations |
| `get_by_id` | `(invitation_id) → dict \| None` | Fetch by PK |
| `get_by_token` | `(token) → dict \| None` | Fetch by the URL token |
| `revoke` | `(invitation_id, revoked_at) → None` | Set revoked_at |
| `accept` | `(invitation_id, accepted_at, accepted_by) → None` | Mark as accepted |
| `list_pending_for_email` | `(email, now_iso) → list[dict]` | All pending invitations for an email (claim on login) |

**Used by:** `api/invitations.py`

---

### `IntegrationRepository` — `database/integrations.py`

Manages `llm_integrations`.

| Method | Signature | Purpose |
|--------|-----------|---------|
| `list_active` | `(llm_id) → list[dict]` | Active integrations for an LLM |
| `upsert` | `(llm_id, integration_type, credentials, status?) → None` | Create or update credentials (conflict on `llm_id, integration_type`) |
| `delete` | `(llm_id, integration_type) → None` | Remove an integration |

**Used by:** `api/integrations/router.py`

---

### `UsageRepository` — `database/usage.py`

Manages `usage_tracking` and reads `profiles.plan`.

| Method | Signature | Purpose |
|--------|-----------|---------|
| `get_plan` | `(user_id) → str` | Read user's plan from profiles |
| `get_tokens_used` | `(user_id, period) → int` | Monthly token total |
| `increment_tokens` | `(user_id, period, tokens) → None` | Atomic increment via RPC `increment_usage` |

**Used by:** `usage.py`

---

### `StorageRepository` — `database/storage.py`

Wraps Supabase Storage for the `agent-outputs` bucket.

| Method | Signature | Purpose |
|--------|-----------|---------|
| `upload` | `(path, data: bytes, content_type) → str` | Upload bytes, return public URL |

Path conventions:
- Charts: `charts/{uuid}.png`
- PDFs: `pdfs/{title}-{uuid}.pdf`
- Written files: `files/{uuid}-{name}`

**Used by:** `agents/tools/stateless/execute_code.py`, `create_chart.py`, `create_pdf.py`, `write_file.py`, `agents/tools/contextual/python_repl.py`

---

### `UserRepository` — `database/users.py`

Wraps Supabase Auth admin API for user lookups.

| Method | Signature | Purpose |
|--------|-----------|---------|
| `get_email` | `(user_id) → str` | Look up email via Supabase auth admin |
| `get_first_name` | `(user_id) → str` | Read first_name from profiles |

**Used by:** `api/invitations.py`

---

## Agent & Business-Logic Classes

### `AgentState` — `agents/agent.py`

A `TypedDict` used as the LangGraph state schema.

| Field | Type | Notes |
|-------|------|-------|
| `messages` | `Annotated[list[BaseMessage], operator.add]` | Message list with append-merge semantics |

---

### `ToolContext` — `agents/tools/context.py`

A `dataclass` that carries per-request state shared across all context-aware tools in a single agent run.

| Field | Type | Notes |
|-------|------|-------|
| `chat_id` | `str` | Current chat |
| `sender_llm_id` | `str` | The LLM running this turn |
| `other_llms_by_name` | `dict[str, str]` | Normalized display_name → llm_id for delegation |
| `delegations` | `list[Delegation]` | Queued handoffs accumulated during the run |
| `repl_namespace` | `dict` | Shared Python namespace for `python_repl` across calls |

---

### `Delegation` — `agents/tools/context.py`

A frozen `dataclass` representing one queued LLM handoff.

| Field | Type |
|-------|------|
| `target_llm_id` | `str` |
| `target_name` | `str` |
| `task` | `str` |
| `message_id` | `str \| None` |

---

### `Settings` — `settings.py`

A `pydantic-settings` `BaseSettings` class. Loaded from `glyph-backend/.env` and cached via `@lru_cache`.

Key fields: `supabase_url`, `supabase_service_key`, `openai_api_key`, `anthropic_api_key`, `google_api_key`, `cors_origins`, `resend_api_key`, `app_url`, `google_client_id`, `google_client_secret`, `langsmith_tracing`, `langsmith_api_key`, `langsmith_project`.

Property: `cors_origins_list` — splits the comma-separated origins string into a list.

---

### Pydantic Request/Response Models — `api/schemas.py`

| Class | Purpose |
|-------|---------|
| `AttachmentInfo` | `{url, mime_type, filename, size}` — file attachment metadata |
| `AskLLMRequest` | `{chat_id, llm_id, side_message_id?, replace_message_id?}` |
| `PlanAgentRequest` | `{chat_id}` |
| `PlanItem` | One step: `{date, task, depends_on, rationale}` |
| `PlannerResponse` | Structured planner output: `{summary, plan: list[PlanItem]}` |

---

## How the Backend Uses These Classes

```
HTTP Request
     │
     ▼
Route handler (api/*.py)
     │  calls get_current_user() + verify_participant() from auth.py
     │  calls check_and_gate() for /askLLM
     │
     ▼
Repository classes (database/*.py)
     │  wrap Supabase client queries
     │
     ▼
Supabase (Postgres + Storage)
```

For the `/askLLM` route, the flow extends further:

```
Route handler (api/ask_llm.py)
     │
     ▼
run_agent_stream() in agents/agent.py
     │  LLMRepository — fetch LLM config & connections
     │  build_context_messages() — assemble history respecting llm_connections
     │  get_model() — instantiate or retrieve cached LangChain model
     │  _build_graph() — compile LangGraph ReAct graph
     │  graph.astream_events() — run agent, yield SSE tokens
     │  MessageRepository — INSERT or UPDATE final message
     │  record_tokens() — persist token usage
     ▼
StreamingResponse (SSE to frontend)
```
