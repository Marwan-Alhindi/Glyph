# KAN-6 — RAG retrieval over uploaded files (nested method subgraph)

## Summary

The agent can now retrieve from files uploaded to a chat. Uploaded text/PDF/CSV/JSON files are
chunked + embedded into a pgvector `documents` table at message-create time. When answering, the
agent calls a `retrieve_documents` tool, which enters a **retrieval subgraph** whose router fans out
to **one node per RAG method** (multi-query, RAG-fusion, HyDE, routing, …); results are merged with
Reciprocal Rank Fusion and returned as cited context. The subgraph is a true nested node in the main
agent graph, so LangSmith/Studio show **one** graph with `retrieve` expandable into its method nodes.

## Why

The backend had no document RAG — uploaded files were only readable ad-hoc via `read_file` (8000-char
cap, no embeddings). The studied RAG strategies (multi-query, HyDE, fusion, routing, self-query, …)
need a base retrieval layer plus a place to live in the graph. This adds both.

## Architecture

**Ingestion (corpus = uploaded files):**
- `api/messages.py::create_message` → `BackgroundTasks` → `agents/rag/ingest.py::ingest_attachments`.
- `agents/rag/chunking.py`: reuses `read_file.extract_text()`, token-aware chunking via tiktoken
  (`cl100k_base`, 800 tok / 120 overlap), batch embeds with OpenAI `text-embedding-3-small`.
- Record-Manager semantics: re-ingesting a source deletes its prior chunks then inserts (idempotent;
  `content_hash` unique index prevents duplicates).

**Retrieval subgraph (`agents/rag/retrieval_graph.py`):**
- `START → router → ⇉ {method nodes} → fuse → END`. State shares the `messages` channel with the
  parent so it reads the `retrieve_documents` tool call and appends a `ToolMessage`.
- `router` (Claude) picks 1–3 methods from `ENABLED_METHODS`; `dispatch` fans out to those nodes in
  parallel; each appends `candidates` (tagged with its method + rank).
- `fuse`: Reciprocal Rank Fusion across methods, dedup by `(source_url, chunk_index)`, top-6, format
  with `[source#chunkN]` citations and a `[methods: …]` header; emits the ToolMessage.

**Main graph wiring (`agents/agent.py::_build_graph`):**
- `retrieve_documents` is bound to the model (agent can request retrieval) but EXCLUDED from
  `ToolNode`. Routing after `agent`: `retrieve_documents` call → `retrieve` subgraph node; other tool
  calls → `tools`; none → END. `AgentState` gained `chat_id` (set in `run_agent_stream`'s initial state).
- `RETRIEVAL_GRAPH` is added via `graph.add_node("retrieve", RETRIEVAL_GRAPH)` → renders nested.

## Methods (staged)

- **Phase 1 (live):** base_retriever, rewrite_retrieve_read, multi_query, rag_fusion (RRF), hyde,
  logical_routing.
- **Phase 2 (live):** semantic_routing (numpy cosine over template embeddings), self_query
  (text→metadata filter via `match_documents` `p_filter`).
- **Phase 3 (nodes present, stubbed — excluded from `ENABLED_METHODS`):** multivector (falls back to
  base until summary rows are indexed), raptor (fallback), colbert (fallback — RAGatouille/torch not
  added), text_to_sql (no-op — no SQL corpus in an uploaded-files design). They appear in the graph
  for completeness; flip into `ENABLED_METHODS` as their infra lands.

## Files

- **Migration:** `## 0014_documents_rag.sql` appended to the Dendron note
  `projects.glyph.backend.sql_migrations.md` (`documents` table + `match_documents` RPC, mirrors
  `0010_memories_pgvector.sql`, no RLS). **Apply it in the Supabase SQL editor before testing.**
- **Created:** `agents/rag/{__init__,chunking,ingest,methods,retrieval_graph,retrieve_tool}.py`.
- **Modified:** `agents/agent.py` (AgentState.chat_id, nested `_build_graph`),
  `agents/tools/stateless/read_file.py` (shared `extract_text`), `api/messages.py` (ingest hook),
  `requirements.txt` (tiktoken).

## Config / prerequisites

- Apply migration `0014` in Supabase. pgvector already enabled (used by `memories`).
- Embeddings reuse the existing OpenAI client; no new env vars.
- No external RAG deps added (tiktoken + numpy + scikit-learn already present).

## How to test

1. Apply `0014` in Supabase; `select * from match_documents('[0,...]'::vector, 0.3, 8, null)` runs (empty, no error).
2. Restart backend: `uvicorn main:app --reload --port 8000`.
3. Upload a file (`POST /uploads`) → `POST /messages` with that attachment → poll
   `select count(*) from documents where chat_id = '<id>'` > 0 (background ingest).
4. Ask a question answerable only from the file. Expect SSE
   `{"type":"tool","name":"retrieve_documents"}`, then a grounded answer citing `[file#chunkN]`.
5. **Negative control:** same question in a chat with no uploads → "No relevant passages," no
   hallucinated content.
6. Which methods ran: read the `[methods: …]` header in the tool result, or LangSmith (the `retrieve`
   node expands into router/method/fuse — one nested graph).
