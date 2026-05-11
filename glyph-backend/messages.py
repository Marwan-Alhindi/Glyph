"""Message endpoints — creating, editing, soft-deleting, context inclusion.

Replaces the direct `supabase.from('messages').insert/update(...)` calls
the frontend used to make. Centralizing here is a prerequisite for:
  - rate limits and cost ceilings
  - turn-cap / mention-gating before LLM agents fire
  - summarization invalidation when included_in_context flips
  - LangSmith correlation ids on every write

The insert response intentionally returns the row joined to
`invited_llms(...)` so the optimistic UI render in Chat.jsx still has the
same shape as the old direct-Supabase response.
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user, verify_participant
from config import supabase
from schemas import AttachmentInfo


router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class CreateMessageRequest(BaseModel):
    chat_id: str
    content: str
    included_in_context: bool = True
    attachments: list[AttachmentInfo] = Field(default_factory=list)
    # `kind` is intentionally not exposed: the column has a 'chat' default and
    # system markers ('join', 'leave', 'delegation') are produced server-side
    # by their dedicated endpoints/tools, not by clients.


class EditMessageRequest(BaseModel):
    content: str


class IncludeInContextRequest(BaseModel):
    chat_id: str
    message_ids: list[str] = Field(min_length=1)
    included: bool = True


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/messages")
def create_message(body: CreateMessageRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    verify_participant(user_id, body.chat_id)

    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="content cannot be empty")

    insert_result = (
        supabase.table("messages")
        .insert({
            "chat_id": body.chat_id,
            "sender_type": "user",
            "sender_user_id": user_id,
            "content": content,
            "included_in_context": body.included_in_context,
            "attachments": [a.model_dump() for a in body.attachments],
        })
        .execute()
    )
    if not insert_result.data:
        raise HTTPException(status_code=500, detail="Failed to insert message")
    new_id = insert_result.data[0]["id"]

    # Re-select with the invited_llms join so the response matches the legacy
    # client-side insert shape (Chat.jsx uses display_name/display_number
    # off the joined row when rendering AI messages).
    full = (
        supabase.table("messages")
        .select("*, invited_llms(id, display_name, display_number, model_type)")
        .eq("id", new_id)
        .single()
        .execute()
    )
    return full.data


@router.patch("/messages/{message_id}")
def edit_message(message_id: str, body: EditMessageRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)

    msg_result = supabase.table("messages").select("*").eq("id", message_id).single().execute()
    msg = msg_result.data
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    # Sender-only edits, and only on user messages. LLM messages are
    # regenerated via /askLLM with replace_message_id, not edited.
    if msg.get("sender_type") != "user" or msg.get("sender_user_id") != user_id:
        raise HTTPException(status_code=403, detail="You can only edit your own messages")

    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="content cannot be empty")

    nowIso = datetime.now(timezone.utc).isoformat()
    supabase.table("messages").update({
        "content": content,
        "edited_at": nowIso,
    }).eq("id", message_id).execute()

    return {"ok": True, "edited_at": nowIso}


@router.delete("/messages/{message_id}")
def delete_message(message_id: str, authorization: str = Header()):
    """Soft delete: sets deleted_at. UI shows tombstone, model context drops it."""
    user_id = get_current_user(authorization)

    msg_result = supabase.table("messages").select("*").eq("id", message_id).single().execute()
    msg = msg_result.data
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    if msg.get("sender_type") != "user" or msg.get("sender_user_id") != user_id:
        raise HTTPException(status_code=403, detail="You can only delete your own messages")

    nowIso = datetime.now(timezone.utc).isoformat()
    supabase.table("messages").update({"deleted_at": nowIso}).eq("id", message_id).execute()

    return {"ok": True, "deleted_at": nowIso}


@router.post("/messages/include_in_context")
def update_inclusion(body: IncludeInContextRequest, authorization: str = Header()):
    """Bulk toggle `included_in_context` for one or more messages in a chat.

    Used when promoting a side message into the main context (or hiding one
    again). Any chat participant may toggle, matching the existing RLS
    policy `messages_update_participant`.
    """
    user_id = get_current_user(authorization)
    verify_participant(user_id, body.chat_id)

    supabase.table("messages").update({
        "included_in_context": body.included,
    }).in_("id", body.message_ids).eq("chat_id", body.chat_id).execute()

    return {"ok": True, "updated_ids": body.message_ids, "included": body.included}