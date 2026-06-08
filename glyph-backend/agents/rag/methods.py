"""One function per RAG method node, plus shared retrieval helpers.

Every node reads `state["question"]` / `state["chat_id"]` and returns
`{"candidates": [...]}` (the subgraph state appends them with operator.add).
Each candidate is a dict: {id, source_url, source_name, chunk_index, content,
similarity, method, rank}. `rank` is the 0-based position within that method's
own result list (used by the final Reciprocal Rank Fusion in retrieval_graph).

Sub-LLM calls (rewrite / multi-query / HyDE / routing / self-query) use the
default Glyph model (Claude). All nodes degrade gracefully to base retrieval
or empty results — retrieval must never hard-fail the agent.
"""

import logging

from agents.rag.chunking import embed_query, embed_texts
from agents.providers.registry import get_model
from dependencies import get_supabase

logger = logging.getLogger(__name__)

MATCH_COUNT = 8
MATCH_THRESHOLD = 0.3

# Methods the router is allowed to dispatch to. Stubbed/heavy methods
# (multivector, raptor, colbert, text_to_sql) are present as nodes for graph
# visibility but excluded here until their infra lands (see plan Phase 2/3).
ENABLED_METHODS = [
    "base_retriever",
    "rewrite_retrieve_read",
    "multi_query",
    "rag_fusion",
    "hyde",
    "logical_routing",
    "semantic_routing",
    "self_query",
]

ALL_METHODS = ENABLED_METHODS + ["multivector", "raptor", "colbert", "text_to_sql"]


# ── shared helpers ────────────────────────────────────────────────────────────

def _llm():
    return get_model("glyph")


def _match(embedding, chat_id, *, match_count=MATCH_COUNT, p_filter=None, p_kind=None):
    """Call the match_documents RPC; return raw rows (list of dicts)."""
    try:
        return get_supabase().rpc("match_documents", {
            "query_embedding": embedding,
            "match_threshold": MATCH_THRESHOLD,
            "match_count": match_count,
            "p_chat_id": chat_id,
            "p_filter": p_filter or {},
            "p_kind": p_kind,
        }).execute().data or []
    except Exception as e:
        logger.warning("match_documents failed: %s", e)
        return []


def _candidates(rows, method):
    out = []
    for rank, r in enumerate(rows):
        out.append({
            "id": r.get("id"),
            "source_url": r.get("source_url"),
            "source_name": r.get("source_name"),
            "chunk_index": r.get("chunk_index"),
            "content": r.get("content"),
            "similarity": r.get("similarity"),
            "method": method,
            "rank": rank,
        })
    return out


def _retrieve_for_text(text, chat_id, method, *, p_filter=None, p_kind=None):
    rows = _match(embed_query(text), chat_id, p_filter=p_filter, p_kind=p_kind)
    return _candidates(rows, method)


def _llm_lines(prompt, *, n_max=6):
    """Run an LLM prompt and return non-empty stripped lines (best-effort)."""
    try:
        resp = _llm().invoke(prompt)
        content = resp.content if hasattr(resp, "content") else str(resp)
        if isinstance(content, list):
            content = "".join(b.get("text", "") for b in content if isinstance(b, dict))
        lines = [ln.strip(" -•\t") for ln in content.splitlines() if ln.strip()]
        return lines[:n_max]
    except Exception as e:
        logger.warning("LLM sub-call failed: %s", e)
        return []


# ── Phase 1: query-side methods ───────────────────────────────────────────────

def base_retriever(state):
    return {"candidates": _retrieve_for_text(state["question"], state["chat_id"], "base_retriever")}


def rewrite_retrieve_read(state):
    q = state["question"]
    lines = _llm_lines(
        f"Rewrite the following question into a single clean, keyword-rich search "
        f"query for document retrieval. Return ONLY the rewritten query.\n\n{q}",
        n_max=1,
    )
    query = lines[0] if lines else q
    return {"candidates": _retrieve_for_text(query, state["chat_id"], "rewrite_retrieve_read")}


def _query_variants(question, n=4):
    lines = _llm_lines(
        f"Generate {n} alternative phrasings of this question for document "
        f"retrieval, each on its own line, no numbering:\n\n{question}",
        n_max=n,
    )
    return lines or [question]


def multi_query(state):
    q, chat_id = state["question"], state["chat_id"]
    variants = [q] + _query_variants(q)
    cands = []
    for v in variants:
        cands.extend(_retrieve_for_text(v, chat_id, "multi_query"))
    return {"candidates": cands}


def rag_fusion(state):
    """Multi-query retrieval fused with Reciprocal Rank Fusion (per-method)."""
    q, chat_id = state["question"], state["chat_id"]
    variants = [q] + _query_variants(q)
    k = 60
    scores: dict = {}
    keep: dict = {}
    for v in variants:
        rows = _match(embed_query(v), chat_id)
        for rank, r in enumerate(rows):
            key = (r.get("source_url"), r.get("chunk_index"))
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
            keep[key] = r
    ranked = sorted(scores, key=scores.get, reverse=True)[:MATCH_COUNT]
    cands = _candidates([keep[key] for key in ranked], "rag_fusion")
    for c, key in zip(cands, ranked):
        c["fusion_score"] = scores[key]
    return {"candidates": cands}


def hyde(state):
    q, chat_id = state["question"], state["chat_id"]
    lines = _llm_lines(
        f"Write a short, plausible passage that would answer this question, as if "
        f"it were an excerpt from a relevant document. Return only the passage.\n\n{q}",
        n_max=12,
    )
    hypo = " ".join(lines) if lines else q
    return {"candidates": _retrieve_for_text(hypo, chat_id, "hyde")}


def _distinct_sources(chat_id):
    try:
        rows = get_supabase().table("documents").select("source_name").eq(
            "chat_id", chat_id).execute().data or []
        return sorted({r["source_name"] for r in rows if r.get("source_name")})
    except Exception:
        return []


def logical_routing(state):
    """LLM picks which uploaded file to scope retrieval to (or all)."""
    q, chat_id = state["question"], state["chat_id"]
    sources = _distinct_sources(chat_id)
    if not sources:
        return {"candidates": _retrieve_for_text(q, chat_id, "logical_routing")}
    listing = "\n".join(f"- {s}" for s in sources)
    lines = _llm_lines(
        f"Given the question and the list of available source files, return ONLY "
        f"the single most relevant filename from the list, or the word ALL if no "
        f"single file is clearly best.\n\nQuestion: {q}\n\nFiles:\n{listing}",
        n_max=1,
    )
    choice = lines[0] if lines else "ALL"
    p_filter = None if choice.upper() == "ALL" or choice not in sources else {"source_name": choice}
    return {"candidates": _retrieve_for_text(q, chat_id, "logical_routing", p_filter=p_filter)}


# ── Phase 2: index-side / structured methods ──────────────────────────────────

# Predefined retrieval "styles" for semantic routing — the query is embedded and
# matched against these template descriptions to pick a retrieval emphasis.
_SEMANTIC_TEMPLATES = {
    "factual": "specific facts, definitions, numbers, names, or direct lookups",
    "conceptual": "high-level concepts, summaries, themes, or how things relate",
    "procedural": "steps, instructions, how-to, or process descriptions",
}


def semantic_routing(state):
    """Cosine-route the query to a retrieval style, then retrieve."""
    q, chat_id = state["question"], state["chat_id"]
    try:
        import numpy as np
        labels = list(_SEMANTIC_TEMPLATES)
        template_embs = np.array(embed_texts([_SEMANTIC_TEMPLATES[l] for l in labels]))
        q_emb = np.array(embed_query(q))
        sims = template_embs @ q_emb / (
            np.linalg.norm(template_embs, axis=1) * np.linalg.norm(q_emb) + 1e-9)
        style = labels[int(np.argmax(sims))]
        logger.info("semantic_routing -> %s", style)
    except Exception as e:
        logger.warning("semantic_routing fell back: %s", e)
    # Style currently influences observability/telemetry; retrieval is the same
    # base similarity search (kept simple — styles can later pick prompts/filters).
    return {"candidates": _retrieve_for_text(q, chat_id, "semantic_routing")}


def self_query(state):
    """Extract a source/metadata filter from the question (text-to-metadata)."""
    q, chat_id = state["question"], state["chat_id"]
    sources = _distinct_sources(chat_id)
    p_filter = None
    if sources:
        listing = ", ".join(sources)
        lines = _llm_lines(
            f"If the question names or strongly implies one of these files, return "
            f"ONLY that exact filename; otherwise return NONE.\nFiles: {listing}\n"
            f"Question: {q}",
            n_max=1,
        )
        choice = lines[0] if lines else "NONE"
        if choice in sources:
            p_filter = {"source_name": choice}
    return {"candidates": _retrieve_for_text(q, chat_id, "self_query", p_filter=p_filter)}


# ── Phase 3: heavy / poor-fit (stubs — fall back to base or no-op) ─────────────

def multivector(state):
    """Search summary chunks, fall back to base if none indexed yet."""
    q, chat_id = state["question"], state["chat_id"]
    rows = _match(embed_query(q), chat_id, p_kind="summary")
    if not rows:
        rows = _match(embed_query(q), chat_id, p_kind="base")
    return {"candidates": _candidates(rows, "multivector")}


def raptor(state):
    """RAPTOR tree levels not yet built at ingest — fall back to base."""
    q, chat_id = state["question"], state["chat_id"]
    return {"candidates": _retrieve_for_text(q, chat_id, "raptor")}


def colbert(state):
    """ColBERT/RAGatouille not wired (heavy dep) — fall back to base."""
    q, chat_id = state["question"], state["chat_id"]
    return {"candidates": _retrieve_for_text(q, chat_id, "colbert")}


def text_to_sql(state):
    """No SQL corpus in an uploaded-files design — no-op (see plan)."""
    return {"candidates": []}


NODE_FUNCS = {
    "base_retriever": base_retriever,
    "rewrite_retrieve_read": rewrite_retrieve_read,
    "multi_query": multi_query,
    "rag_fusion": rag_fusion,
    "hyde": hyde,
    "logical_routing": logical_routing,
    "semantic_routing": semantic_routing,
    "self_query": self_query,
    "multivector": multivector,
    "raptor": raptor,
    "colbert": colbert,
    "text_to_sql": text_to_sql,
}
