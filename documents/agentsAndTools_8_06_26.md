# Agents & Tools

All agent code lives in `glyph-backend/agents/`. The system uses **LangGraph** for graph execution and **LangChain** for model abstraction.

---

## LangGraph Graph

### Architecture — `agents/agent.py` + `agents/graph.py`

The chat agent uses a **ReAct** (Reason + Act) loop — a two-node graph that alternates between calling the LLM and executing tools.

```
START
  │
  ▼
┌─────────┐   has tool_calls   ┌───────┐
│  agent  │ ─────────────────▶ │ tools │
│  (LLM)  │ ◀────────────────  └───────┘
└─────────┘   always loop back
  │
  │  no tool_calls (plain reply)
  ▼
 END
```

**Nodes:**
- `agent` — calls `bound_model.invoke(state["messages"])` — the LLM with tools bound to it.
- `tools` — `ToolNode(tools)` — executes all tool calls the LLM requested in parallel.

**Edges:**
- `START → agent` (entry point)
- `agent → tools` (conditional: last message has `tool_calls`)
- `agent → END` (conditional: last message is a plain text reply)
- `tools → agent` (unconditional: always loop back after tools run)

**State schema (`AgentState`):**
```python
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], operator.add]
```
The `operator.add` annotation means each node's returned messages are **appended** to the list rather than replacing it.

**Recursion limit:** 50 steps. If exceeded, the agent returns a graceful fallback message.

---

## Agents

### Chat Agent — `run_agent_stream()` in `agents/agent.py`

**Type:** Streaming (async generator → SSE)

**Entry point:** `POST /askLLM`

**What it does:**
1. Fetches the LLM config from `invited_llms` (display name, system prompt, model type).
2. Builds a `ToolContext` with the chat ID, LLM ID, and a name-to-ID map of sibling LLMs.
3. Calls `build_context_messages()` to assemble the history the LLM is allowed to see.
4. Instantiates a model via `get_model(model_type)`.
5. Builds a fresh LangGraph graph with tools bound for this run.
6. Streams events via `graph.astream_events(version="v2")`:
   - `on_chat_model_stream` → emits `{type: "token"}` SSE events
   - `on_tool_start` → emits `{type: "tool"}` SSE events
   - `on_chat_model_end` → accumulates token usage
   - `on_chain_end` → captures final messages
7. Inserts or updates the final message row in Supabase.
8. Emits the `{type: "done"}` SSE event.
9. Records token usage via `record_tokens()`.

**Regenerate mode:** When `replace_message_id` is set, context is truncated to messages strictly *before* that message, and the result is `UPDATE`d onto the existing row instead of inserted.

**Side-ask mode:** When `side_message_id` is set, that message is force-included in context even if `included_in_context=false`. The reply is stored with `included_in_context=false` and linked via `side_parent_message_id`.

---

### Planner Agent — `run_planner()` in `agents/agent.py`

**Type:** One-shot, structured output

**Entry point:** Called from the planner view Agent pane (via `POST /chats/{chat_id}/plan` or equivalent frontend call)

**What it does:**
1. Loads all `daily_notes` for the chat via `DailyNotesRepository`.
2. Returns early if no notes or no open tasks (`- [ ]`).
3. Formats notes as a single user message grouped by date.
4. Runs a `ChatPromptTemplate | get_model("glyph").with_structured_output(PlannerResponse)` chain — guaranteed valid JSON output.
5. Returns a `PlannerResponse` with an ordered `plan` that respects inferred task dependencies.

**Output schema:**
```python
class PlannerResponse(BaseModel):
    summary: str          # One-sentence overview
    plan: list[PlanItem]  # Tasks in execution order
```
```python
class PlanItem(BaseModel):
    date: str             # YYYY-MM-DD
    task: str             # Exact text from the markdown
    depends_on: list[str] # Prerequisite task texts
    rationale: str        # Why this position in the plan
```

---

### Join Agent — `generate_join_message()` in `agents/agent.py`

**Type:** One-shot, plain text

**Triggered:** When an LLM is invited via `POST /inviteLLM`

**What it does:** Calls `get_model("glyph") | StrOutputParser()` with a simple prompt asking the model to introduce itself by name. The resulting text is inserted as a `kind='join'` message.

**Prompt:**
> "Please type a message to indicate you have joined the chat with mentioning your name. Your name is: {display_name}"

---

## Model Registry — `agents/providers/registry.py`

`get_model(model_type)` returns a cached `BaseChatModel`. Results are stored in a module-level `_registry` dict — each model is instantiated only once per process.

| `model_type` | Model | Provider |
|-------------|-------|----------|
| `"openai"` | `gpt-4o` | OpenAI |
| `"gemini"` | `gemini-2.0-flash` | Google |
| anything else (`"glyph"`, `"anthropic"`, custom) | `claude-sonnet-4-6` | Anthropic |

All models are initialized with `streaming=True`. The Claude model additionally sets:
- `thinking={"type": "enabled", "budget_tokens": 8000}` (extended thinking)
- `max_tokens=16000`

`is_claude(model_type)` returns `True` for everything except `"openai"` and `"gemini"`. This is used in `run_agent_stream` to decide whether to add Anthropic's cache-control breakpoint to the system prompt.

---

## Context Builder — `agents/context_builder.py`

`build_context_messages(chat_id, llm_id, system_prompt, ...)` assembles the message list the LLM is allowed to see, returning `list[BaseMessage]` consumed directly by the graph.

**Visibility rules (enforced via `llm_connections`):**
- An LLM always sees its own past messages → `AIMessage`
- An LLM sees user messages only if it has a `target_type='user'` connection → `HumanMessage`
- An LLM sees another LLM's messages only if it has a `target_type='llm'` connection to that specific LLM → `HumanMessage` prefixed with the sender's display name
- Messages with `deleted_at` set are skipped entirely
- Messages with `included_in_context=false` are skipped unless force-included

**System prompt caching:** When `cache_system_prompt=True` (Claude models), the system prompt is wrapped with Anthropic's `cache_control: ephemeral` breakpoint to reduce costs on repeated calls.

**Attachment handling (`_build_human_message`):**
- Image attachments → multimodal `image_url` blocks in the `HumanMessage` content
- Non-image files → text hints instructing the LLM to use `read_file` with the URL

---

## Tools

### Tool Context (`agents/tools/context.py`)

`ToolContext` is a `dataclass` passed to all context-aware tool factories. It carries:
- `chat_id` — current chat
- `sender_llm_id` — the LLM running this turn
- `other_llms_by_name` — normalized `display_name → llm_id` map for delegation
- `delegations` — list of `Delegation` objects queued during this run
- `repl_namespace` — shared Python `exec` namespace for `python_repl` across calls

### Tool Registry (`agents/tools/registry.py`)

`get_tools(ctx=None)` returns the tool list for an agent run:
- Without `ctx` → stateless tools only (safe at import time, used for LangGraph Studio)
- With `ctx` → stateless tools + 3 context-aware tools (`python_repl`, `query_chat_data`, `save_memory` + `recall_memories`)

---

### Stateless Tools

These tools have no dependency on the current chat or LLM. They can be imported and used without a `ToolContext`.

---

#### `web_search` — `agents/tools/stateless/web_search.py`

Search the web for current information using DuckDuckGo (`ddgs`).

- **Input:** `query: str`
- **Returns:** Up to 5 results formatted as `- Title (URL): snippet`
- **Use case:** Questions about recent events or facts outside training data

---

#### `read_url` — `agents/tools/stateless/read_url.py`

Fetch and return the full text content of a URL.

- **Input:** `url: str`
- **Returns:** Cleaned text (strips scripts, nav, footer) up to 8000 chars. Non-HTML content returned as-is.
- **Use case:** Reading articles, documentation, GitHub files, or any URL in full

---

#### `execute_code` — `agents/tools/stateless/execute_code.py`

Execute a self-contained code snippet in an isolated subprocess.

- **Input:** `code: str`, `language: str` (`"python"` or `"javascript"`)
- **Returns:** stdout/stderr up to 4000 chars. For Python, matplotlib charts are automatically uploaded to Supabase Storage and returned as markdown image URLs.
- **Use case:** One-off calculations, data processing. Each call is isolated — variables do not persist. For a stateful session use `python_repl` instead.
- **Timeout:** 60 seconds

**Chart upload flow:**
1. A preamble redirects `plt.savefig` to write to a temp dir and print `GLYPH_LOCAL:/path` markers.
2. A postamble auto-saves any open figures.
3. The tool post-processes stdout, uploads files via `StorageRepository`, and replaces markers with image URLs.

---

#### `read_file` — `agents/tools/stateless/read_file.py`

Read the text content of an uploaded file by URL.

- **Input:** `url: str`
- **Returns:** Raw text up to 8000 chars. PDFs are extracted with `pdfplumber`.
- **Use case:** Reading attachments the user uploaded to the chat

---

#### `create_chart` — `agents/tools/stateless/create_chart.py`

Generate a chart image and upload it to Supabase Storage.

- **Input:** `chart_type` (`bar`|`line`|`pie`|`scatter`), `title`, `data` (JSON string with `labels` and `series`), `x_label`, `y_label`
- **Returns:** Markdown `![title](url)` and download link string that the LLM must include verbatim in its reply
- **Use case:** Data visualization from structured data

---

#### `write_file` — `agents/tools/stateless/write_file.py`

Save text content as a downloadable file.

- **Input:** `filename: str`, `content: str`
- **Returns:** Markdown download link string
- **Supported extensions:** html, csv, json, md, py, js, ts, png, jpg, svg, etc.
- **Use case:** Exporting code, CSVs, markdown docs, JSON files

---

#### `create_pdf` — `agents/tools/stateless/create_pdf.py`

Generate a formatted PDF from markdown content using `reportlab`.

- **Input:** `title: str`, `content: str`
- **Returns:** URL of the uploaded PDF; the LLM must include it as a markdown download link
- **Supported markdown:** `**bold**`, `*italic*`, `#` headings, bullet lists (`-`, `*`, `+`), numbered lists, pipe tables, `![alt](url)` images, code blocks (` ``` `)
- **Use case:** When the user asks to create, export, or download a PDF

---

### Contextual Tools

These tools require a `ToolContext` and are created via factory functions. They are bound to a specific chat/LLM pair for the duration of one agent run.

---

#### `python_repl` — `agents/tools/contextual/python_repl.py`

Execute Python code in a **persistent** session.

- **Factory:** `make_python_repl_tool(ctx: ToolContext)`
- **Input:** `code: str`
- **Returns:** stdout/stderr + chart URLs for any matplotlib figures
- **Key difference from `execute_code`:** Variables, imports, and results persist in `ctx.repl_namespace` across multiple calls within the same conversation turn. Each new message starts a fresh session.
- **Use case:** Iterative data analysis, multi-step computations, building on previous results

---

#### `query_chat_data` — `agents/tools/contextual/query_chat.py`

Query data from the current chat.

- **Factory:** `make_query_tool(ctx: ToolContext)`
- **Input:** `query_type: str` (`recent_messages` | `user_messages` | `my_messages` | `daily_notes`), `limit: int` (1–100, default 20)
- **Returns:** Formatted text summary of the requested data
- **Use case:** Summarising history, reviewing planner notes, looking up past decisions

---

#### `save_memory` — `agents/tools/contextual/memory.py`

Persist a fact or preference to long-term memory for this chat.

- **Factory:** part of `make_memory_tools(ctx)`
- **Input:** `content: str`
- **Process:** Generates an embedding via OpenAI `text-embedding-3-small`, then inserts into the `memories` table with the embedding vector.
- **Returns:** Confirmation string
- **Use case:** Important facts, user preferences, decisions that should survive across sessions

---

#### `recall_memories` — `agents/tools/contextual/memory.py`

Search long-term memory for relevant facts.

- **Factory:** part of `make_memory_tools(ctx)`
- **Input:** `query: str`, `limit: int` (1–20, default 5)
- **Process:** Generates a query embedding, calls the `match_memories` Postgres RPC (pgvector cosine similarity, threshold 0.3), scoped to the current `chat_id`.
- **Returns:** Ranked list of memories with similarity scores
- **Use case:** Before answering questions about past decisions or stored user preferences

---

#### `delegate` — `agents/tools/contextual/delegate.py`

Hand off a task to another LLM in the chat.

- **Factory:** `make_delegate_tool(ctx)` — **not currently included in the default registry** (present in code but not in `get_tools`)
- **Input:** `target_name: str` (display name, case-insensitive), `task: str` (self-contained instruction)
- **Process:** Inserts a `kind='delegation'` message into the `messages` table, queues a `Delegation` object onto `ctx.delegations`.
- **Returns:** Confirmation that the delegation was queued
- **Use case:** Multi-agent pipelines where one LLM produces output for another (e.g. researcher → designer)

---

## System Prompts — `agents/prompts.py`

### `PLANNER_SYSTEM_PROMPT`
Instructs the planner agent to:
1. Extract every open task (`- [ ]`) across all daily notes
2. Infer dependencies from language cues
3. Produce a single ordered plan respecting dependencies, surfacing ready tasks first

### `JOIN_PROMPT_USER`
Template: `"Please type a message to indicate you have joined the chat with mentioning your name. Your name is: {display_name}"`

### Dynamic system prompt (built in `_build_system_prompt`)
Each LLM's system prompt is assembled at run time by combining:
1. The LLM's `model_instruct` field (user-defined persona)
2. Two lines identifying the LLM's display name in the chat and explaining `@mention` semantics

---

## LangSmith Tracing

Every agent run is tagged and traced via LangSmith when `LANGSMITH_TRACING=true` in `.env`. Each run includes:
- `run_name`: `{chat_id[:8]}_{llm_name}` for chat runs, `{chat_id[:8]}_planner` for planner, `join_{display_name}` for join
- `tags`: `["chat_agent", chat_id, llm_id, llm_name]`
- `metadata`: `{ chat_id, llm_id, llm_name, user_id, ls_thread_id: "{chat_id}_{llm_id}" }`

The `ls_thread_id` groups all turns of the same LLM within a chat into a single LangSmith thread.
