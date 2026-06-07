from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from auth import get_current_user, verify_participant
from database.chats import ChatRepository
from database.messages import MessageRepository
from usage import get_plan_limits

router = APIRouter()


class CreateChatRequest(BaseModel):
    name: str | None = None


class RenameChatRequest(BaseModel):
    name: str


class PinChatRequest(BaseModel):
    pinned: bool


@router.post("/chats")
def create_chat(body: CreateChatRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    name = (body.name or "New chat").strip() or "New chat"

    chat_repo = ChatRepository()
    limits = get_plan_limits(user_id)
    if limits["max_chats"] is not None:
        owned = chat_repo.count_owned_by_user(user_id)
        if owned >= limits["max_chats"]:
            raise HTTPException(
                status_code=403,
                detail=f"Free plan is limited to {limits['max_chats']} chats. Upgrade to create more.",
            )
    chat = chat_repo.create(name, user_id)
    participant = chat_repo.add_participant(chat["id"], user_id, role="owner")

    return {
        "chat": chat,
        "participant": {
            "role": "owner",
            "pinned_at": participant.get("pinned_at"),
            "joined_at": participant.get("joined_at") or participant.get("created_at"),
        },
    }


@router.patch("/chats/{chat_id}")
def rename_chat(chat_id: str, body: RenameChatRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    verify_participant(user_id, chat_id)

    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    ChatRepository().rename(chat_id, new_name)
    return {"ok": True, "name": new_name}


@router.patch("/chats/{chat_id}/pin")
def pin_chat(chat_id: str, body: PinChatRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    verify_participant(user_id, chat_id)

    pinned_at = datetime.now(timezone.utc).isoformat() if body.pinned else None
    ChatRepository().update_pin(chat_id, user_id, pinned_at)
    return {"ok": True, "pinned_at": pinned_at}


@router.post("/chats/{chat_id}/leave")
def leave_chat(chat_id: str, authorization: str = Header()):
    user_id = get_current_user(authorization)
    verify_participant(user_id, chat_id)

    chat_repo = ChatRepository()
    first_name = chat_repo.get_profile_first_name(user_id)

    MessageRepository().create(
        chat_id=chat_id,
        sender_type="user",
        content=f"{first_name} left the chat",
        sender_user_id=user_id,
        kind="leave",
    )
    chat_repo.remove_participant(chat_id, user_id)
    return {"ok": True}
