"""FastAPI application — middleware, router registration."""

from fastapi import FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware

from auth import get_current_user
from settings import get_settings
from usage import get_usage_summary

from api.ask_llm import router as ask_llm_router
from api.chats import router as chats_router
from api.messages import router as messages_router
from api.participants import router as participants_router
from api.invitations import router as invitations_router
from api.uploads import router as uploads_router
from api.integrations.router import router as integrations_router
from api.payments import router as payments_router


def _setup_tracing() -> None:
    import os
    s = get_settings()
    if s.langsmith_tracing.lower() == "true" and s.langsmith_api_key:
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGCHAIN_API_KEY"] = s.langsmith_api_key
        os.environ["LANGCHAIN_PROJECT"] = s.langsmith_project
        print(f"[langsmith] tracing on, project={s.langsmith_project}")
    else:
        os.environ.pop("LANGCHAIN_TRACING_V2", None)
        print("[langsmith] tracing off")


_setup_tracing()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Welcome to Glyph backend"}


@app.get("/usage")
def usage_summary(authorization: str = Header()):
    user_id = get_current_user(authorization)
    return get_usage_summary(user_id)


app.include_router(ask_llm_router)
app.include_router(chats_router)
app.include_router(messages_router)
app.include_router(participants_router)
app.include_router(invitations_router)
app.include_router(uploads_router)
app.include_router(integrations_router)
app.include_router(payments_router)
