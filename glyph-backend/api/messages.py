from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user, verify_participant
from database.messages import MessageRepository
from api.schemas import AttachmentInfo
from agents.rag.ingest import ingest_attachments

router = APIRouter()


class CreateMessageRequest(BaseModel):
    chat_id: str
    content: str
    included_in_context: bool = True
    attachments: list[AttachmentInfo] = Field(default_factory=list)


class EditMessageRequest(BaseModel):
    content: str


class IncludeInContextRequest(BaseModel):
    chat_id: str
    message_ids: list[str] = Field(min_length=1)
    included: bool = True


@router.post("/messages")
def create_message(
    body: CreateMessageRequest,
    background: BackgroundTasks,
    authorization: str = Header(),
):
    user_id = get_current_user(authorization)
    verify_participant(user_id, body.chat_id)

    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="content cannot be empty")

    attachments = [a.model_dump() for a in body.attachments]
    row = MessageRepository().create_user_message(
        chat_id=body.chat_id,
        sender_user_id=user_id,
        content=content,
        included_in_context=body.included_in_context,
        attachments=attachments,
    )
    if not row:
        raise HTTPException(status_code=500, detail="Failed to insert message")

    # RAG: chunk + embed any text/PDF/CSV/JSON attachments off the request path
    # so the agent can retrieve over them. Images are skipped (handled by vision).
    if attachments:
        background.add_task(ingest_attachments, body.chat_id, attachments)

    return row


@router.patch("/messages/{message_id}")
def edit_message(message_id: str, body: EditMessageRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    repo = MessageRepository()

    msg = repo.get_by_id(message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.get("sender_type") != "user" or msg.get("sender_user_id") != user_id:
        raise HTTPException(status_code=403, detail="You can only edit your own messages")

    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="content cannot be empty")

    now_iso = datetime.now(timezone.utc).isoformat()
    repo.edit(message_id, content, now_iso)
    return {"ok": True, "edited_at": now_iso}


@router.delete("/messages/{message_id}")
def delete_message(message_id: str, authorization: str = Header()):
    user_id = get_current_user(authorization)
    repo = MessageRepository()

    msg = repo.get_by_id(message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.get("sender_type") != "user" or msg.get("sender_user_id") != user_id:
        raise HTTPException(status_code=403, detail="You can only delete your own messages")

    now_iso = datetime.now(timezone.utc).isoformat()
    repo.soft_delete(message_id, now_iso)
    return {"ok": True, "deleted_at": now_iso}


@router.post("/messages/include_in_context")
def update_inclusion(body: IncludeInContextRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    verify_participant(user_id, body.chat_id)

    MessageRepository().update_inclusion(body.message_ids, body.chat_id, body.included)
    return {"ok": True, "updated_ids": body.message_ids, "included": body.included}
