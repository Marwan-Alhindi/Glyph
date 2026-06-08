"""All agent entry points.

Public surface:
  run_agent_stream(chat_id, llm_id, user_id, ...)  — streaming chat agent (LangGraph + SSE)
  run_planner(chat_id) -> PlannerResponse           — one-shot planner (structured output)
  generate_join_message(display_name) -> str        — one-shot join greeting
"""

import asyncio
import json
import operator
import re
from typing import Annotated, TypedDict

from fastapi import HTTPException
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langgraph.errors import GraphRecursionError
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode

from agents.context_builder import build_context_messages
from agents.prompts import JOIN_PROMPT_USER, PLANNER_SYSTEM_PROMPT
from agents.providers.registry import get_model, is_claude
from agents.tools.context import ToolContext
from agents.tools.registry import get_tools
from api.schemas import PlannerResponse
from database.daily_notes import DailyNotesRepository
from database.llms import LLMRepository
from database.messages import MessageRepository
from usage import check_and_gate, record_tokens

RECURSION_LIMIT = 50

# How many automatic LLM→LLM delegation hops to allow per human message.
# 1 = the directly-asked LLM may hand off once; that delegate cannot delegate
# further. Bounds runaway loops and token spend.
MAX_DELEGATION_HOPS = 1


# ── Shared helpers ────────────────────────────────────────────────────────────

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _normalize_llm_name(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").lstrip("@").strip()).lower()


# ── LangGraph state ───────────────────────────────────────────────────────────

class AgentState(TypedDict, total=False):
    # Annotated with operator.add so each node's returned messages are
    # appended to the list rather than replacing it.
    messages: Annotated[list[BaseMessage], operator.add]
    # chat_id is shared with the retrieval subgraph node so it can scope
    # match_documents to this chat. Set in the initial state in run_agent_stream.
    chat_id: str


# ── Graph builder ─────────────────────────────────────────────────────────────

def _build_graph(model, tools):
    """Build and compile the ReAct tool-calling graph with a nested RAG node.

    Nodes
    -----
    agent     — calls the LLM with the full message history
    tools     — executes every tool call the LLM requested (via ToolNode)
    retrieve  — the RAG retrieval SUBGRAPH (router → method nodes → fuse),
                added as a compiled-graph node so it renders nested in one graph

    Edges
    -----
    START     → agent
    agent     → retrieve  (conditional: last message calls `retrieve_documents`)
    agent     → tools     (conditional: last message has other tool_calls)
    agent     → END       (conditional: last message is a plain reply)
    tools     → agent
    retrieve  → agent

    `retrieve_documents` is bound to the model (so the agent can request
    retrieval) but EXCLUDED from ToolNode — its execution is the retrieve
    subgraph node, which reads the tool call's `question` arg from the message
    history and appends a ToolMessage with the grounded result.
    """
    from agents.rag.retrieve_tool import retrieve_documents
    from agents.rag.retrieval_graph import RETRIEVAL_GRAPH

    bound_model = model.bind_tools(list(tools) + [retrieve_documents])
    tool_node = ToolNode(tools)  # retrieve_documents intentionally excluded

    def call_model(state: AgentState) -> dict:
        response = bound_model.invoke(state["messages"])
        return {"messages": [response]}

    def retrieve_node(state: AgentState) -> dict:
        """Wrapper that runs the RAG subgraph and returns ONLY the resulting
        ToolMessage(s) — never the history — so the parent message list is not
        duplicated. Satisfies every tool call in the triggering AI message."""
        last = state["messages"][-1]
        tool_calls = getattr(last, "tool_calls", None) or []
        msgs: list[BaseMessage] = []
        context = None
        for tc in tool_calls:
            if tc.get("name") == "retrieve_documents":
                if context is None:
                    question = (tc.get("args") or {}).get("question") or ""
                    result = RETRIEVAL_GRAPH.invoke(
                        {"question": question, "chat_id": state.get("chat_id")}
                    )
                    context = result.get("answer_context") or \
                        "No relevant passages found in the uploaded files."
                    msgs.append(ToolMessage(content=context, tool_call_id=tc["id"]))
                else:
                    msgs.append(ToolMessage(content="(see retrieval result above)", tool_call_id=tc["id"]))
            else:
                msgs.append(ToolMessage(
                    content=f"(`{tc.get('name')}` was not run this turn — call it again on its own.)",
                    tool_call_id=tc["id"]))
        return {"messages": msgs}

    def route_after_agent(state: AgentState) -> str:
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and getattr(last, "tool_calls", None):
            names = [tc.get("name") for tc in last.tool_calls]
            if "retrieve_documents" in names:
                return "retrieve"
            return "tools"
        return END

    graph = StateGraph(AgentState)

    graph.add_node("agent", call_model)
    graph.add_node("tools", tool_node)
    graph.add_node("retrieve", retrieve_node)

    graph.set_entry_point("agent")

    graph.add_conditional_edges(
        "agent",
        route_after_agent,
        {"tools": "tools", "retrieve": "retrieve", END: END},
    )
    graph.add_edge("tools", "agent")
    graph.add_edge("retrieve", "agent")

    return graph.compile()


# ── System prompt ─────────────────────────────────────────────────────────────

def _build_system_prompt(
    base_prompt: str,
    llm_name: str,
    other_llm_names: list[str] | None = None,
) -> str:
    effective_base = base_prompt or "You are a helpful AI assistant."
    separator = "\n\n---\n" if base_prompt else "\n"
    lines = [
        f"Your display name in this chat is @{llm_name}.",
        f"If a user message starts with @{llm_name}, it is addressed directly to you.",
    ]
    if other_llm_names:
        names = ", ".join(f"@{n}" for n in other_llm_names)
        lines.append(
            f"Other AI teammates in this chat: {names}. When the right next step "
            "is for one of them to act on your output, use the `delegate` tool to "
            "hand the task to them by name. Simply mentioning their name in your "
            "reply text does NOT reach them — only the delegate tool does."
        )
    return effective_base + separator + "\n".join(lines)


def _extract_final_text(messages: list[BaseMessage]) -> str:
    for msg in reversed(messages):
        if isinstance(msg, AIMessage) and msg.content:
            if isinstance(msg.content, str):
                return msg.content
            parts = [
                p.get("text", "")
                for p in msg.content
                if isinstance(p, dict) and p.get("type") == "text"
            ]
            text = "".join(parts).strip()
            if text:
                return text
    return ""


# ── Chat agent (streaming) ────────────────────────────────────────────────────

async def run_agent_stream(
    chat_id: str,
    llm_id: str,
    user_id: str,
    replace_message_id: str | None = None,
    side_message_id: str | None = None,
    force_include_message_ids: set[str] | None = None,
    _depth: int = 0,
):
    """Async generator — yields SSE events as the LangGraph agent runs.

    force_include_message_ids: message ids to make visible to this LLM even if
        its connection filter would hide them (used to deliver a delegation task).
    _depth: how many delegation hops deep this run is (0 = directly asked by a
        human). Internal — set automatically when chaining delegations.
    """
    llm = LLMRepository().get_by_id(llm_id)
    if not llm:
        yield _sse({"type": "error", "llm_id": llm_id, "detail": "LLM not found"})
        return

    llm_name = llm.get("display_name") or "LLM"

    other_llms = [
        r for r in LLMRepository().list_by_chat(chat_id, exclude_id=llm_id)
        if r.get("display_name")
    ]
    system_prompt = _build_system_prompt(
        llm.get("model_instruct") or "",
        llm_name,
        [r["display_name"] for r in other_llms],
    )

    tool_ctx = ToolContext(
        chat_id=chat_id,
        sender_llm_id=llm_id,
        other_llms_by_name={
            _normalize_llm_name(r["display_name"]): r["id"] for r in other_llms
        },
    )

    try:
        initial_messages = build_context_messages(
            chat_id,
            llm_id,
            system_prompt,
            up_to_message_id=replace_message_id,
            include_message_id=side_message_id,
            force_include_message_ids=force_include_message_ids,
            cache_system_prompt=is_claude(llm.get("model_type")),
        )
    except Exception as e:
        yield _sse({"type": "error", "llm_id": llm_id, "detail": f"Failed to load context: {e}"})
        return

    model = get_model(llm.get("model_type"))
    graph = _build_graph(model, get_tools(tool_ctx))

    final_messages: list[BaseMessage] = []
    final_text = ""
    tokens_used = 0

    run_name = f"{chat_id[:8]}_{llm_name}"
    try:
        async for event in graph.astream_events(
            {"messages": initial_messages, "chat_id": chat_id},
            version="v2",
            config={
                "recursion_limit": RECURSION_LIMIT,
                "run_name": run_name,
                "tags": ["chat_agent", chat_id, llm_id, llm_name],
                "metadata": {
                    "chat_id": chat_id,
                    "llm_id": llm_id,
                    "llm_name": llm_name,
                    "user_id": user_id,
                    "ls_thread_id": f"{chat_id}_{llm_id}",
                },
            },
        ):
            kind = event["event"]

            if kind == "on_chat_model_stream":
                chunk = event["data"].get("chunk")
                content = getattr(chunk, "content", "") or ""
                if isinstance(content, list):
                    content = "".join(
                        block.get("text", "")
                        for block in content
                        if isinstance(block, dict) and block.get("type") == "text"
                    )
                if content:
                    yield _sse({"type": "token", "llm_id": llm_id, "content": content})

            elif kind == "on_tool_start":
                yield _sse({"type": "tool", "llm_id": llm_id, "name": event.get("name", "")})

            elif kind == "on_chat_model_end":
                output = (event.get("data") or {}).get("output")
                meta = getattr(output, "usage_metadata", None)
                if meta:
                    tokens_used += meta.get("total_tokens", 0)

            elif kind == "on_chain_end":
                output = (event.get("data") or {}).get("output")
                if isinstance(output, dict) and isinstance(output.get("messages"), list):
                    final_messages = output["messages"]

    except asyncio.CancelledError:
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

    msg_repo = MessageRepository()
    if replace_message_id:
        updated = msg_repo.update_content(replace_message_id, final_text, chat_id, llm_id)
        msg_id = updated["id"] if updated else replace_message_id
    else:
        row = msg_repo.create(
            chat_id=chat_id,
            sender_type="llm",
            content=final_text,
            sender_llm_id=llm_id,
            included_in_context=side_message_id is None,
            side_parent_message_id=side_message_id,
        )
        msg_id = row["id"]

    yield _sse({"type": "done", "llm_id": llm_id, "message_id": msg_id, "content": final_text})

    if tokens_used > 0:
        try:
            record_tokens(user_id, tokens_used)
        except Exception:
            pass

    # ── LLM→LLM delegation chaining ───────────────────────────────────────────
    # If this agent used the delegate tool, run each target now, streaming its
    # reply into the same SSE response. Bounded by MAX_DELEGATION_HOPS so a
    # delegate cannot keep handing off forever. Only fresh replies chain —
    # regenerations and side-asks do not.
    if (
        replace_message_id is None
        and side_message_id is None
        and _depth < MAX_DELEGATION_HOPS
        and tool_ctx.delegations
    ):
        seen_targets: set[str] = set()
        for d in tool_ctx.delegations:
            if d.target_llm_id in seen_targets:
                continue
            seen_targets.add(d.target_llm_id)

            # Gate each hop against the user's plan. If over budget, surface it
            # and stop the chain rather than crashing the stream.
            try:
                check_and_gate(user_id)
            except HTTPException as e:
                yield _sse({
                    "type": "error",
                    "llm_id": d.target_llm_id,
                    "detail": getattr(e, "detail", "Usage limit reached"),
                })
                break

            yield _sse({
                "type": "agent_start",
                "llm_id": d.target_llm_id,
                "from_llm_id": llm_id,
                "delegation_message_id": d.message_id,
            })

            async for event in run_agent_stream(
                chat_id,
                d.target_llm_id,
                user_id,
                force_include_message_ids={d.message_id} if d.message_id else None,
                _depth=_depth + 1,
            ):
                yield event


# ── Planner agent (one-shot, structured output) ───────────────────────────────

def run_planner(chat_id: str) -> PlannerResponse:
    notes = DailyNotesRepository().list_by_chat(chat_id)
    if not notes:
        return PlannerResponse(summary="No notes for this chat yet.", plan=[])
    if not any("- [ ]" in (r.get("content") or "") for r in notes):
        return PlannerResponse(summary="No open tasks found.", plan=[])

    user_message = "\n\n".join(
        f"## {r['date']}\n{(r.get('content') or '').strip() or '(empty)'}"
        for r in notes
    )

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=PLANNER_SYSTEM_PROMPT),
        ("user", "{notes}"),
    ])
    chain = prompt | get_model("glyph").with_structured_output(PlannerResponse)

    try:
        return chain.invoke(
            {"notes": user_message},
            config={
                "run_name": f"{chat_id[:8]}_planner",
                "tags": ["planner_agent", chat_id],
                "metadata": {"chat_id": chat_id},
            },
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Planner failed: {e}")


# ── Join agent (one-shot, plain text) ─────────────────────────────────────────

def generate_join_message(display_name: str, chat_id: str, llm_id: str) -> str:
    prompt = ChatPromptTemplate.from_messages([("user", JOIN_PROMPT_USER)])
    chain = prompt | get_model("glyph") | StrOutputParser()
    return chain.invoke(
        {"display_name": display_name},
        config={
            "run_name": f"join_{display_name}",
            "tags": ["join_agent", display_name],
            "metadata": {
                "llm_name": display_name,
                "chat_id": chat_id,
                "llm_id": llm_id,
                "ls_thread_id": f"{chat_id}_{llm_id}",
            },
        },
    )
