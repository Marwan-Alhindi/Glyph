"""Streaming chat agent for /askLLM.

Built on `langchain.agents.create_agent`, which returns a compiled LangGraph
runnable. We stream events from the graph via `astream_events(version="v2")`
and bridge them to the SSE wire format the frontend consumes:

    {type: "token", llm_id, content}      # on every model token chunk
    {type: "tool", llm_id, name}          # whenever a tool starts
    {type: "agent_start", llm_id, ...}    # delegated model is starting
    {type: "done", llm_id, message_id, content}  # after persisting the final message
    {type: "error", llm_id?, detail}      # on errors

The chat row is inserted into Supabase by THIS module (not the agent), so
the realtime push to other participants still happens at the right moment.
"""

import asyncio
import json
from dataclasses import dataclass, field

from langchain.agents import create_agent
from langchain_core.messages import AIMessage
from langchain_openai import ChatOpenAI
from langgraph.errors import GraphRecursionError

from config import supabase
from context import build_context_messages
from tools import Delegation, ToolContext, get_tools, normalize_llm_name


# Hard cap on how many model+tool iterations the agent can run. Each
# iteration is roughly model_call → tool_node → model_call, so a
# recursion_limit of ~12 mirrors the legacy MAX_ITERATIONS=5 behavior with
# a small safety margin.
RECURSION_LIMIT = 12


@dataclass
class AgentRunResult:
    message_id: str | None = None
    content: str = ""
    delegations: list[Delegation] = field(default_factory=list)


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


# Model is reused across requests; the agent itself is built per-request so
# context-aware tools (delegate) can close over chat_id / sender_llm_id /
# the participants list.
_chat_model = ChatOpenAI(model="gpt-4o", streaming=True)


def _build_tool_context(chat_id: str, sender_llm_id: str) -> ToolContext:
    """Fetch the other invited LLMs in this chat for the delegate tool's name lookup."""
    rows = (
        supabase.table("invited_llms")
        .select("id, display_name")
        .eq("chat_id", chat_id)
        .neq("id", sender_llm_id)
        .execute()
        .data
        or []
    )
    return ToolContext(
        chat_id=chat_id,
        sender_llm_id=sender_llm_id,
        other_llms_by_name={
            normalize_llm_name(r.get("display_name") or ""): r["id"]
            for r in rows
            if r.get("display_name")
        },
    )


def _fetch_llm(llm_id: str) -> dict | None:
    result = (
        supabase.table("invited_llms")
        .select("*")
        .eq("id", llm_id)
        .single()
        .execute()
    )
    return result.data


def _augment_system_prompt(
    base_prompt: str,
    ctx: ToolContext,
    llm_name: str,
    allow_delegation: bool,
    gather_mode: bool = False,
) -> str:
    """Append mention/delegation rules so @mentions are interpreted as routing."""
    normalized_self = normalize_llm_name(llm_name)
    others = ", ".join(f"@{name.title()}" for name in sorted(ctx.other_llms_by_name.keys()))
    lines = [
        "\n\n---",
        f"Your display name in this chat is @{llm_name}.",
        f"If a user message includes @{llm_name}, treat that as a direct address to you, not as an instruction to contact yourself.",
        "If you receive a message like `OtherModel: -> @You: task`, that is an internal delegated task for you. Do the task directly.",
        "The user should only see final outcomes. Do not mention internal handoff messages, tool calls, delegation status, or phrases like 'I will now share this' in your final reply.",
    ]
    if gather_mode:
        lines.append(
            "All models you delegated to have now completed their tasks. Their responses are included in the conversation above. "
            "Synthesize their results to complete the original user request. Do not delegate further — produce the final answer directly."
        )
    elif allow_delegation:
        lines.append(
            "When the user asks you to share, hand off, or provide your findings to another model, first complete your own work, then call the `delegate` tool with the target model and a self-contained task that includes the useful results or context they need."
        )
        lines.append("Do not claim that you delegated or asked another model unless the `delegate` tool succeeds.")
        if others:
            lines.append(f"Other LLMs in this chat you can delegate to: {others}.")
        else:
            lines.append("There are no other LLMs available to delegate to in this chat.")
        lines.append(
            "Use delegation only when the next action genuinely belongs to another LLM; casual references do not need a handoff."
        )
    else:
        lines.append("This run was triggered by another model's handoff. The latest `-> @You:` handoff is your primary task; earlier user messages or mentions are background only. Do not delegate, hand off, or ask another model to do anything. Answer your assigned task directly as your final outcome.")
    if normalized_self in ctx.other_llms_by_name:
        lines.append("Never delegate to yourself.")
    return (base_prompt or "") + "\n".join(lines)


def _extract_final_text(final_messages) -> str:
    if not final_messages:
        return ""
    for msg in reversed(final_messages):
        if isinstance(msg, AIMessage) and msg.content:
            if isinstance(msg.content, str):
                return msg.content
            parts = [p.get("text", "") for p in msg.content if isinstance(p, dict)]
            text = "".join(parts).strip()
            if text:
                return text
    return ""


async def _run_agent_once(
    chat_id: str,
    llm: dict,
    user_id: str,
    result: AgentRunResult,
    replace_message_id: str | None = None,
    side_message_id: str | None = None,
    force_include_message_ids: set[str] | None = None,
    allow_delegation: bool = True,
    gather_mode: bool = False,
):
    llm_id = llm["id"]
    tool_ctx = _build_tool_context(chat_id, llm_id)
    llm_name = llm.get("display_name") or "LLM"
    augmented_system_prompt = _augment_system_prompt(
        llm.get("model_instruct") or "",
        tool_ctx,
        llm_name,
        allow_delegation,
        gather_mode=gather_mode,
    )

    initial_messages = build_context_messages(
        chat_id,
        llm_id,
        augmented_system_prompt,
        up_to_message_id=replace_message_id,
        include_message_id=side_message_id,
        force_include_message_ids=force_include_message_ids,
    )

    # Only the user-addressed root model can delegate. Delegated models answer
    # their task directly, which keeps one user turn to one visible reply per
    # involved model instead of model-to-model loops.
    agent = create_agent(model=_chat_model, tools=get_tools(tool_ctx if allow_delegation else None))

    final_messages = None
    final_text = ""

    try:
        async for event in agent.astream_events(
            {"messages": initial_messages},
            version="v2",
            config={
                "recursion_limit": RECURSION_LIMIT,
                "run_name": "chat_agent",
                "tags": ["chat_agent", chat_id, llm_id],
                "metadata": {"chat_id": chat_id, "llm_id": llm_id, "user_id": user_id},
            },
        ):
            kind = event["event"]
            if kind == "on_chat_model_stream":
                chunk = event["data"].get("chunk")
                content = getattr(chunk, "content", "") or ""
                if content:
                    yield _sse({"type": "token", "llm_id": llm_id, "content": content})
            elif kind == "on_tool_start":
                yield _sse({"type": "tool", "llm_id": llm_id, "name": event.get("name", "")})
            elif kind == "on_chain_end":
                # The root graph emits its final state on its own on_chain_end.
                # We can't always rely on the name, so capture the most recent
                # output that looks like an agent state (has a "messages" list).
                output = (event.get("data") or {}).get("output")
                if isinstance(output, dict) and isinstance(output.get("messages"), list):
                    final_messages = output["messages"]
    except asyncio.CancelledError:
        # Client disconnected — likely the user hit "Stop". Do NOT persist a
        # partial reply and do NOT fire queued delegations: clear them so the
        # outer loop sees nothing to chain. Re-raise so the SSE generator ends.
        result.delegations = []
        raise
    except GraphRecursionError:
        final_text = "I hit my step limit before I could finish. Please ask again with a narrower scope."
    except Exception as e:
        yield _sse({"type": "error", "llm_id": llm_id, "detail": f"Model error: {e}"})
        return

    if not final_text:
        final_text = _extract_final_text(final_messages)

    if not final_text.strip():
        final_text = "(empty response)"

    if replace_message_id:
        update_result = (
            supabase.table("messages")
            .update({"content": final_text})
            .eq("id", replace_message_id)
            .eq("chat_id", chat_id)
            .eq("sender_llm_id", llm_id)
            .execute()
        )
        msg_id = update_result.data[0]["id"] if update_result.data else replace_message_id
    else:
        insert_result = supabase.table("messages").insert({
            "chat_id": chat_id,
            "sender_type": "llm",
            "sender_llm_id": llm_id,
            "content": final_text,
            "included_in_context": side_message_id is None,
            "side_parent_message_id": side_message_id,
        }).execute()
        msg_id = insert_result.data[0]["id"] if insert_result.data else None

    result.message_id = msg_id
    result.content = final_text
    result.delegations = list(tool_ctx.delegations)

    yield _sse({"type": "done", "llm_id": llm_id, "message_id": msg_id, "content": final_text})


async def run_agent_stream(
    chat_id: str,
    llm_id: str,
    user_id: str,
    replace_message_id: str | None = None,
    side_message_id: str | None = None,
):
    """Async generator yielding SSE events as the agent runs.

    When `replace_message_id` is provided, the agent regenerates that row in
    place: context is truncated to messages strictly before it, and the
    final answer is UPDATEd onto that row instead of inserted as a new one.

    Delegations produced by the user-addressed LLM are run once after its own
    response is saved. Delegated LLMs do not receive the delegate tool.
    """
    llm = _fetch_llm(llm_id)
    if not llm:
        yield _sse({"type": "error", "llm_id": llm_id, "detail": "LLM not found"})
        return

    root_result = AgentRunResult()
    try:
        async for event in _run_agent_once(
            chat_id,
            llm,
            user_id,
            root_result,
            replace_message_id=replace_message_id,
            side_message_id=side_message_id,
        ):
            yield event
    except asyncio.CancelledError:
        # User stopped the root LLM mid-stream. Don't fan out to delegations.
        raise

    seen_targets: set[str] = set()
    delegated_results: list[AgentRunResult] = []
    for delegation in root_result.delegations:
        if delegation.target_llm_id in seen_targets:
            continue
        seen_targets.add(delegation.target_llm_id)
        target_llm = _fetch_llm(delegation.target_llm_id)
        if not target_llm:
            yield _sse({
                "type": "error",
                "llm_id": delegation.target_llm_id,
                "detail": f"Delegated target @{delegation.target_name} was not found",
            })
            continue

        yield _sse({
            "type": "agent_start",
            "llm_id": delegation.target_llm_id,
            "from_llm_id": llm_id,
            "target_name": delegation.target_name,
            "delegation_message_id": delegation.message_id,
        })

        delegated_result = AgentRunResult()
        try:
            async for event in _run_agent_once(
                chat_id,
                target_llm,
                user_id,
                delegated_result,
                force_include_message_ids={delegation.message_id} if delegation.message_id else None,
                allow_delegation=False,
            ):
                yield event
        except asyncio.CancelledError:
            # User stopped during a delegated run. Stop the chain entirely.
            raise
        delegated_results.append(delegated_result)

    # Gather phase: if any delegations ran, re-run the root LLM so it can
    # synthesize all sub-agent results into a final reply.
    if delegated_results:
        # Force-include the delegation task messages and all sub-agent replies
        # so the root LLM can see the full picture even for messages that were
        # marked included_in_context=false.
        force_ids: set[str] = set()
        for d in root_result.delegations:
            if d.message_id:
                force_ids.add(d.message_id)
        for dr in delegated_results:
            if dr.message_id:
                force_ids.add(dr.message_id)

        yield _sse({"type": "agent_start", "llm_id": llm_id, "gather": True})

        gather_result = AgentRunResult()
        try:
            async for event in _run_agent_once(
                chat_id,
                llm,
                user_id,
                gather_result,
                force_include_message_ids=force_ids if force_ids else None,
                allow_delegation=False,
                gather_mode=True,
            ):
                yield event
        except asyncio.CancelledError:
            raise
