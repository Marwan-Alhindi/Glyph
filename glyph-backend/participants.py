"""Participants endpoints — invite LLMs, list participants, manifest.

This is the single source of truth for "who is in this chat" so the
frontend doesn't reimplement the `llm_connections` filtering for display.
The same shape will be injected into agent system prompts (as the
'participants manifest') in a follow-up.

Endpoints:
  POST  /inviteLLM                       create LLM + connections + post join msg (atomic-ish)
  GET   /chats/{chat_id}/participants    full manifest: people + LLMs + their connections
"""

from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from agents.join_agent import generate_join_message
from auth import get_current_user, verify_participant
from config import supabase


router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class LLMConnectionInput(BaseModel):
    """Each entry: who this new LLM should be able to see.

    `target_type='user'` means "this LLM sees user messages" (target_llm_id ignored).
    `target_type='llm'` means "this LLM sees the named LLM's messages" (target_llm_id required).
    """
    target_type: Literal["user", "llm"]
    target_llm_id: str | None = None


class InviteLLMRequest(BaseModel):
    chat_id: str
    display_name: str
    model_instruct: str = ""
    connections: list[LLMConnectionInput] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _next_display_number(chat_id: str) -> int:
    """LLM display numbers are 1-indexed within a chat (used as labels in UI)."""
    rows = (
        supabase.table("invited_llms")
        .select("display_number")
        .eq("chat_id", chat_id)
        .execute()
        .data
        or []
    )
    return max((r.get("display_number") or 0) for r in rows) + 1 if rows else 1


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/inviteLLM")
def invite_llm(body: InviteLLMRequest, authorization: str = Header()):
    """Create the LLM, persist its visibility connections, and post its join
    message. All in one server-owned flow so the frontend can't end up with
    a half-invited LLM (e.g. row exists, no connections, no join message).
    """
    user_id = get_current_user(authorization)
    verify_participant(user_id, body.chat_id)

    name = body.display_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="display_name cannot be empty")

    display_number = _next_display_number(body.chat_id)

    llm_insert = (
        supabase.table("invited_llms")
        .insert({
            "chat_id": body.chat_id,
            "display_name": name,
            "model_instruct": body.model_instruct or "",
            "display_number": display_number,
            "invited_by": user_id,
        })
        .execute()
    )
    if not llm_insert.data:
        raise HTTPException(status_code=500, detail="Failed to create LLM")
    llm = llm_insert.data[0]

    conn_rows = []
    for c in body.connections:
        if c.target_type == "llm" and not c.target_llm_id:
            raise HTTPException(status_code=400, detail="target_llm_id required when target_type='llm'")
        conn_rows.append({
            "llm_id": llm["id"],
            "target_type": c.target_type,
            "target_llm_id": c.target_llm_id if c.target_type == "llm" else None,
        })

    target_ids = [c.target_llm_id for c in body.connections if c.target_type == "llm" and c.target_llm_id]
    if target_ids:
        valid_rows = (
            supabase.table("invited_llms")
            .select("id")
            .eq("chat_id", body.chat_id)
            .in_("id", target_ids)
            .execute()
            .data or []
        )
        valid_ids = {r["id"] for r in valid_rows}
        bad = [t for t in target_ids if t not in valid_ids]
        if bad:
            raise HTTPException(status_code=400, detail="target_llm_id does not belong to this chat")

    if conn_rows:
        conn_result = supabase.table("llm_connections").insert(conn_rows).execute()
        if not conn_result.data:
            raise HTTPException(status_code=500, detail="Failed to create LLM connections")

    join_text = generate_join_message(name)
    supabase.table("messages").insert({
        "chat_id": body.chat_id,
        "sender_type": "llm",
        "sender_llm_id": llm["id"],
        "content": join_text,
        "kind": "join",
    }).execute()

    return {
        "llm": llm,
        "connections": conn_rows,
        "join_message": join_text,
    }


@router.get("/chats/{chat_id}/participants")
def list_participants(chat_id: str, authorization: str = Header()):
    """Return the full participants manifest for a chat.

    Frontend uses this for the visibility filter UI (and avoids reimplementing
    the llm_connections logic). Future: same shape feeds agent system prompts.
    """
    user_id = get_current_user(authorization)
    verify_participant(user_id, chat_id)

    participants = (
        supabase.table("chat_participants")
        .select("user_id, role, joined_at, profiles(id, first_name, last_name)")
        .eq("chat_id", chat_id)
        .execute()
        .data
        or []
    )

    llms = (
        supabase.table("invited_llms")
        .select("id, display_name, display_number, model_instruct, invited_by, created_at")
        .eq("chat_id", chat_id)
        .order("display_number")
        .execute()
        .data
        or []
    )

    llm_ids = [l["id"] for l in llms]
    connections: list[dict] = []
    if llm_ids:
        connections = (
            supabase.table("llm_connections")
            .select("id, llm_id, target_type, target_llm_id")
            .in_("llm_id", llm_ids)
            .execute()
            .data
            or []
        )

    by_llm = {l["id"]: {**l, "connections": []} for l in llms}
    for c in connections:
        if c["llm_id"] in by_llm:
            by_llm[c["llm_id"]]["connections"].append(c)

    return {
        "people": [
            {
                "user_id": p["user_id"],
                "role": p.get("role"),
                "joined_at": p.get("joined_at"),
                "first_name": (p.get("profiles") or {}).get("first_name"),
                "last_name": (p.get("profiles") or {}).get("last_name"),
            }
            for p in participants
        ],
        "llms": list(by_llm.values()),
    }
