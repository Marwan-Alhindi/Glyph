"""FastAPI bootstrap: app instance, middleware, static mounts, route handlers.

Domain logic lives elsewhere:
- config.py     — env, OpenAI/Supabase/JWKS clients, LangSmith setup
- auth.py       — JWT + chat membership
- schemas.py    — pydantic request/response models for /askLLM and /planAgent
- context.py    — chat history → messages with llm_connections filtering
- tools.py      — agent tools (web_search, create_pdf)
- agents/       — chat_agent, planner_agent, join_agent
- chats         — chat lifecycle (create/rename/pin/leave)
- messages      — message CRUD (insert/edit/delete/include_in_context)
- participants  — invite LLMs + participants manifest
- invitations   — email invite flow
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from config import CHARTS_DIR, FILES_DIR, PDFS_DIR, setup_tracing
from auth import get_current_user, verify_participant
from schemas import AskLLMRequest, PlanAgentRequest
from agents.chat_agent import run_agent_stream
from agents.planner_agent import run_planner
from chats import router as chats_router
from messages import router as messages_router
from participants import router as participants_router
from invitations import router as invitations_router
from uploads import router as uploads_router

from fastapi import Header


setup_tracing()

app = FastAPI()

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/pdfs", StaticFiles(directory=PDFS_DIR), name="pdfs")
app.mount("/charts", StaticFiles(directory=CHARTS_DIR), name="charts")
app.mount("/files", StaticFiles(directory=FILES_DIR), name="files")


@app.get("/")
def read_root():
    return {"message": "Welcome to Langpulse backend"}


@app.post("/askLLM")
def ask_llm(body: AskLLMRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    verify_participant(user_id, body.chat_id)
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


@app.post("/planAgent")
def plan_agent(body: PlanAgentRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    verify_participant(user_id, body.chat_id)
    result = run_planner(body.chat_id)
    return result.model_dump()


app.include_router(chats_router)
app.include_router(messages_router)
app.include_router(participants_router)
app.include_router(invitations_router)
app.include_router(uploads_router)
