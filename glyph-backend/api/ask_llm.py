from fastapi import APIRouter, Header
from fastapi.responses import StreamingResponse

from agents.agent import run_agent_stream
from auth import get_current_user, verify_participant
from api.schemas import AskLLMRequest
from usage import check_and_gate

router = APIRouter()


@router.post("/askLLM")
def ask_llm(body: AskLLMRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    verify_participant(user_id, body.chat_id)
    check_and_gate(user_id)
    return StreamingResponse(
        run_agent_stream(
            body.chat_id,
            body.llm_id,
            user_id,
            replace_message_id=body.replace_message_id,
            side_message_id=body.side_message_id,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
