# KAN-5 — LLM can trigger other LLMs via Delegation

## Summary

An invited LLM can now hand a follow-up task to another LLM in the same chat.
The first model completes its part, calls the `delegate` tool to pass a
self-contained task to a named teammate, and that teammate runs automatically —
its reply streams into the same response. This enables multi-agent flows like
**Teacher → Quizzer** (teach, then hand off to quiz the student).

## Why

Previously, when one LLM wrote `@OtherModel` in its reply, nothing happened — the
mention→trigger logic only ran for **human-sent** messages (in the frontend
`handleSend`). LLM-authored text was never parsed for mentions, so models could
*say* "your turn, Quizzer" but could not actually invoke another model. Most of
the delegation machinery already existed but was never connected.

## How it works (end to end)

1. The asked LLM runs as usual (`run_agent_stream` in
   `glyph-backend/agents/agent.py`).
2. If the right next step is another model, it calls the **`delegate(target_name,
   task)`** tool (`glyph-backend/agents/tools/contextual/delegate.py`). The tool:
   - inserts a hidden message row with `kind: "delegation"` (content
     `-> @Target: task`), and
   - queues a `Delegation` onto `ToolContext.delegations`.
3. After the asked LLM's reply is persisted, `run_agent_stream` drains
   `tool_ctx.delegations`. For each unique target it:
   - gates the hop against the user's plan (`check_and_gate`),
   - emits an SSE `agent_start` event (`{llm_id, from_llm_id,
     delegation_message_id}`), and
   - recursively runs the target via `run_agent_stream(..., _depth=_depth+1,
     force_include_message_ids={delegation_msg_id})`, streaming its tokens/`done`
     into the same response.
4. `build_context_messages` force-includes the delegation message so the target
   sees the handoff task even if its `llm_connections` filter would hide it.
5. The frontend (`Chat.jsx`) already handles `agent_start` — it shows the target
   as pending (with `delegatedFromLlmId` / `delegationMessageId`), then the
   target's INSERT realtime push renders its reply in the workspace. Delegation
   rows (`kind === 'delegation'`) are hidden from the normal timeline.

## Hop limit (loop guard)

`MAX_DELEGATION_HOPS = 1` in `glyph-backend/agents/agent.py`. The directly-asked
LLM may delegate once; the delegated LLM **cannot** delegate further. This bounds
runaway loops and token spend. Increase to 2–3 to allow back-and-forth (e.g.
Quizzer reporting a score back to Teacher). Regenerations and side-asks never
chain.

## Files touched

- `glyph-backend/agents/tools/registry.py` — registered `make_delegate_tool` in
  `get_tools()` (the tool existed but was never given to models — the core bug).
- `glyph-backend/agents/agent.py`
  - `MAX_DELEGATION_HOPS` constant.
  - `_build_system_prompt` now lists other AI teammates and instructs models to
    use the `delegate` tool (plain @mentions do not reach other models).
  - `run_agent_stream` gained `force_include_message_ids` and `_depth` params,
    plumbs `force_include_message_ids` into `build_context_messages`, and runs
    queued delegations as chained SSE sub-streams.

(No frontend changes — `agent_start` handling and delegation-row hiding already
existed in `Chat.jsx`.)

## Config / DB prerequisites

- The `messages` table must have a `kind` column (used for `kind: "delegation"`).
  Verify:
  ```sql
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'messages' AND column_name = 'kind';
  ```
  If missing: `ALTER TABLE messages ADD COLUMN kind text;`
- For a delegate to actually act on the chat, it needs the appropriate
  `llm_connections` (e.g. connected to the user and/or the delegating LLM) so its
  context is non-empty.

## How to test

1. Restart the backend: `uvicorn main:app --reload --port 8000`.
2. Create a chat with two models, e.g. **Teacher** and **Quizzer**.
3. Tell the Teacher to teach a concept, then hand off to the Quizzer to quiz you.
4. Expect: the Teacher's reply completes, then the Quizzer fires automatically and
   posts a quiz to the workspace pane — without you sending another message.
5. With the 1-hop limit, the Quizzer will **not** auto-trigger the Teacher back;
   send the next human message for that.
