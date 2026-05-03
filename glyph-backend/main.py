from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from openai import OpenAI
from dotenv import load_dotenv
from supabase import create_client
import jwt
import json
import os

from tools import TOOL_SCHEMAS, execute_tool

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

MAX_ITERATIONS = 5

app = FastAPI()

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PDFS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pdfs")
os.makedirs(PDFS_DIR, exist_ok=True)
app.mount("/pdfs", StaticFiles(directory=PDFS_DIR), name="pdfs")

# Supabase client (service role — bypasses RLS)
supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_KEY")
)

jwks_client = jwt.PyJWKClient(f"{os.getenv('SUPABASE_URL')}/auth/v1/.well-known/jwks.json")

openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def get_current_user(authorization: str = Header()):
    """Verify Supabase JWT via JWKS and return user UUID."""
    token = authorization.replace("Bearer ", "")
    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
        )
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {type(e).__name__}")


def verify_participant(user_id: str, chat_id: str):
    """Check that the user is a participant of the chat."""
    result = supabase.table("chat_participants").select("id").eq("chat_id", chat_id).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=403, detail="Not a participant of this chat")


def generate_join_message(display_name: str) -> str:
    """Ask the model for a short intro message for a newly-joined LLM."""
    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "user", "content": f"Please type a message to indicate you have joined the chat with mentioning your name. Your name is: {display_name}"}
        ],
    )
    return response.choices[0].message.content


def build_context_messages(chat_id: str, llm_id: str, system_prompt: str) -> list:
    """Build the OpenAI messages array for one LLM, respecting its llm_connections."""
    conn_result = supabase.table("llm_connections").select("*").eq("llm_id", llm_id).execute()
    connections = conn_result.data or []
    connected_to_user = any(c["target_type"] == "user" for c in connections)
    connected_llm_ids = [c["target_llm_id"] for c in connections if c["target_type"] == "llm"]

    msgs_result = (
        supabase.table("messages")
        .select("*, invited_llms(display_name)")
        .eq("chat_id", chat_id)
        .order("created_at")
        .execute()
    )
    chat_messages = msgs_result.data or []

    api_messages = [{"role": "system", "content": system_prompt or ""}]
    for msg in chat_messages:
        if msg["sender_type"] == "llm" and msg["sender_llm_id"] == llm_id:
            api_messages.append({"role": "assistant", "content": msg["content"]})
        elif msg["sender_type"] == "user" and connected_to_user:
            api_messages.append({"role": "user", "content": msg["content"]})
        elif msg["sender_type"] == "llm" and msg["sender_llm_id"] in connected_llm_ids:
            sender_name = (msg.get("invited_llms") or {}).get("display_name") or "LLM"
            api_messages.append({"role": "user", "content": f"{sender_name}: {msg['content']}"})
    return api_messages


def run_agent(chat_id: str, llm_id: str, user_id: str, depth: int = 0) -> str:
    """Run the agent loop for one LLM turn. Persists the final reply and returns it."""
    llm_result = supabase.table("invited_llms").select("*").eq("id", llm_id).single().execute()
    llm = llm_result.data
    if not llm:
        raise HTTPException(status_code=404, detail="LLM not found")

    api_messages = build_context_messages(chat_id, llm_id, llm.get("model_instruct") or "")

    ctx = {
        "chat_id": chat_id,
        "calling_llm_id": llm_id,
        "user_id": user_id,
        "depth": depth,
        "supabase": supabase,
        "run_agent": run_agent,
        "generate_join_message": generate_join_message,
    }

    for _ in range(MAX_ITERATIONS):
        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=api_messages,
            tools=TOOL_SCHEMAS,
            tool_choice="auto",
        )
        msg = response.choices[0].message

        if not msg.tool_calls:
            final_text = msg.content or ""
            supabase.table("messages").insert({
                "chat_id": chat_id,
                "sender_type": "llm",
                "sender_llm_id": llm_id,
                "content": final_text,
            }).execute()
            return final_text

        api_messages.append({
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in msg.tool_calls
            ],
        })

        for tc in msg.tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError as e:
                tool_output = f"Could not parse arguments: {e}"
            else:
                tool_output = execute_tool(tc.function.name, args, ctx)

            api_messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": tool_output,
            })

    fallback = "I hit my step limit before I could finish. Please ask again with a narrower scope."
    supabase.table("messages").insert({
        "chat_id": chat_id,
        "sender_type": "llm",
        "sender_llm_id": llm_id,
        "content": fallback,
    }).execute()
    return fallback


class InviteLLMRequest(BaseModel):
    chat_id: str
    llm_id: str


class AskLLMRequest(BaseModel):
    chat_id: str
    llm_id: str


@app.get("/")
def read_root():
    return {"message": "Welcome to Langpulse backend"}


@app.post("/inviteLLM")
def invite_llm(body: InviteLLMRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    verify_participant(user_id, body.chat_id)

    llm_result = supabase.table("invited_llms").select("*").eq("id", body.llm_id).single().execute()
    llm = llm_result.data
    if not llm:
        raise HTTPException(status_code=404, detail="LLM not found")

    join_text = generate_join_message(llm["display_name"])
    supabase.table("messages").insert({
        "chat_id": body.chat_id,
        "sender_type": "llm",
        "sender_llm_id": body.llm_id,
        "content": join_text,
        "kind": "join",
    }).execute()

    return {"response": join_text}


@app.post("/askLLM")
def ask_llm(body: AskLLMRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    verify_participant(user_id, body.chat_id)
    text = run_agent(chat_id=body.chat_id, llm_id=body.llm_id, user_id=user_id)
    return {"response": text}
