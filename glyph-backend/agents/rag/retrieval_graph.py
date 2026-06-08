"""The RAG retrieval subgraph — a nested node inside the main agent graph.

Shape:  START -> router -> ⇉ {one node per RAG method} -> fuse -> END

It shares the `messages` channel with the parent AgentState, so it reads the
agent's `retrieve_documents` tool call from the last message and appends a
ToolMessage with the fused, cited context. Because it is added to the parent as
a compiled-graph node, LangSmith/Studio render it as ONE nested graph (the
`retrieve` node expands into router/method/fuse), not a separate graph.
"""

import logging
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

from agents.rag.methods import ALL_METHODS, ENABLED_METHODS, NODE_FUNCS, _llm_lines

logger = logging.getLogger(__name__)

TOP_K = 6          # chunks returned to the agent after fusion
RRF_K = 60         # Reciprocal Rank Fusion constant


class RetrievalState(TypedDict, total=False):
    # NOTE: deliberately does NOT share the parent's `messages` channel. A
    # compiled subgraph used as a node writes its whole final state back to the
    # parent; with an operator.add messages reducer that duplicates the entire
    # history (incl. the system prompt) → "multiple non-consecutive system
    # messages". Instead the subgraph takes {question, chat_id} and returns
    # answer_context; the parent wrapper node turns that into one ToolMessage.
    chat_id: str
    question: str
    methods: list[str]
    candidates: Annotated[list[dict], operator.add]
    answer_context: str


# ── router ────────────────────────────────────────────────────────────────────

def router(state: RetrievalState) -> dict:
    question = state.get("question") or ""
    methods = ["base_retriever"]
    if question:
        choices = _llm_lines(
            "You are a retrieval strategist. Pick 1-3 retrieval methods best "
            "suited to answer the question from uploaded documents. Return ONLY "
            "method names, one per line, chosen from this list:\n"
            + ", ".join(ENABLED_METHODS)
            + f"\n\nQuestion: {question}",
            n_max=3,
        )
        picked = [c.strip() for c in choices if c.strip() in ENABLED_METHODS]
        methods = list(dict.fromkeys(["base_retriever", *picked]))
    if methods == ["base_retriever"]:
        # No useful router output — use a sensible default ensemble.
        methods = ["base_retriever", "rag_fusion", "hyde"]
    logger.info("RAG router selected: %s", methods)
    return {"methods": methods}


def dispatch(state: RetrievalState) -> list[str]:
    """Conditional fan-out: run each selected method node in parallel."""
    methods = [m for m in state.get("methods", []) if m in NODE_FUNCS]
    return methods or ["base_retriever"]


# ── fuse ──────────────────────────────────────────────────────────────────────

def fuse(state: RetrievalState) -> dict:
    candidates = state.get("candidates", [])

    # Reciprocal Rank Fusion across methods, deduped by (source_url, chunk_index).
    scores: dict = {}
    keep: dict = {}
    for c in candidates:
        key = (c.get("source_url"), c.get("chunk_index"))
        scores[key] = scores.get(key, 0.0) + 1.0 / (RRF_K + c.get("rank", 0))
        # keep the richest copy (highest similarity) for display
        if key not in keep or (c.get("similarity") or 0) > (keep[key].get("similarity") or 0):
            keep[key] = c
    ranked = sorted(scores, key=scores.get, reverse=True)[:TOP_K]

    methods_run = sorted({c.get("method") for c in candidates if c.get("method")})
    header = f"[methods: {', '.join(methods_run)}]" if methods_run else "[methods: none]"

    if not ranked:
        answer_context = f"{header}\nNo relevant passages found in the uploaded files."
    else:
        blocks = []
        for key in ranked:
            c = keep[key]
            cite = f"{c.get('source_name') or 'file'}#chunk{c.get('chunk_index')}"
            blocks.append(f"[{cite}]\n{c.get('content', '').strip()}")
        answer_context = header + "\n\n" + "\n\n---\n\n".join(blocks)

    # Return only answer_context — the parent wrapper node builds the ToolMessage.
    return {"answer_context": answer_context}


# ── build ─────────────────────────────────────────────────────────────────────

def _build_retrieval_graph():
    g = StateGraph(RetrievalState)
    g.add_node("router", router)
    for name in ALL_METHODS:
        g.add_node(name, NODE_FUNCS[name])
    g.add_node("fuse", fuse)

    g.add_edge(START, "router")
    g.add_conditional_edges("router", dispatch, {name: name for name in ALL_METHODS})
    for name in ALL_METHODS:
        g.add_edge(name, "fuse")
    g.add_edge("fuse", END)
    return g.compile()


RETRIEVAL_GRAPH = _build_retrieval_graph()
