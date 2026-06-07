from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from agents.agent import generate_join_message
from auth import get_current_user, verify_participant
from database.chats import ChatRepository
from database.llms import LLMRepository
from database.messages import MessageRepository

router = APIRouter()


class LLMConnectionInput(BaseModel):
    target_type: Literal["user", "llm"]
    target_llm_id: str | None = None


class InviteLLMRequest(BaseModel):
    chat_id: str
    display_name: str
    model_instruct: str = ""
    model_type: str = "openai"
    connections: list[LLMConnectionInput] = Field(default_factory=list)


@router.post("/inviteLLM")
def invite_llm(body: InviteLLMRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    verify_participant(user_id, body.chat_id)

    name = body.display_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="display_name cannot be empty")

    llm_repo = LLMRepository()
    display_number = llm_repo.get_next_display_number(body.chat_id)
    llm = llm_repo.create(
        chat_id=body.chat_id,
        display_name=name,
        model_instruct=body.model_instruct or "",
        model_type=body.model_type or "openai",
        display_number=display_number,
        invited_by=user_id,
    )
    if not llm:
        raise HTTPException(status_code=500, detail="Failed to create LLM")

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
        valid_ids = llm_repo.validate_llm_ids_in_chat(body.chat_id, target_ids)
        bad = [t for t in target_ids if t not in valid_ids]
        if bad:
            raise HTTPException(status_code=400, detail="target_llm_id does not belong to this chat")

    if conn_rows:
        result = llm_repo.create_connections(conn_rows)
        if not result:
            raise HTTPException(status_code=500, detail="Failed to create LLM connections")

    join_text = generate_join_message(name, body.chat_id, llm["id"])
    MessageRepository().create(
        chat_id=body.chat_id,
        sender_type="llm",
        content=join_text,
        sender_llm_id=llm["id"],
        kind="join",
    )

    return {"llm": llm, "connections": conn_rows, "join_message": join_text}


@router.get("/chats/{chat_id}/participants")
def list_participants(chat_id: str, authorization: str = Header()):
    user_id = get_current_user(authorization)
    verify_participant(user_id, chat_id)

    chat_repo = ChatRepository()
    llm_repo = LLMRepository()

    participants = chat_repo.list_participants_with_profiles(chat_id)
    llms = llm_repo.list_by_chat_full(chat_id)
    llm_ids = [l["id"] for l in llms]
    connections = llm_repo.list_connections_for_llms(llm_ids)

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
