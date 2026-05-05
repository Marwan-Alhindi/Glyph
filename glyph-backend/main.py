from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def run_agent_stream(chat_id: str, llm_id: str, user_id: str):
    """Generator yielding SSE events as the agent runs.

    Token-level streaming for the final answer. Tool-call iterations accumulate
    silently and emit a 'tool' event so the client can keep the connection alive.
    On completion, persists the final message and yields a 'done' event with
    the new message id.
    """
    llm_result = supabase.table("invited_llms").select("*").eq("id", llm_id).single().execute()
    llm = llm_result.data
    if not llm:
        yield _sse({"type": "error", "detail": "LLM not found"})
        return

    api_messages = build_context_messages(chat_id, llm_id, llm.get("model_instruct") or "")
    ctx = {
        "chat_id": chat_id,
        "calling_llm_id": llm_id,
        "user_id": user_id,
        "supabase": supabase,
    }

    final_text = ""

    for _ in range(MAX_ITERATIONS):
        try:
            stream = openai_client.chat.completions.create(
                model="gpt-4o",
                messages=api_messages,
                tools=TOOL_SCHEMAS,
                tool_choice="auto",
                stream=True,
            )
        except Exception as e:
            yield _sse({"type": "error", "detail": f"Model error: {e}"})
            return

        accumulated_content = ""
        accumulated_tool_calls: dict[int, dict] = {}

        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta

            if delta.content:
                accumulated_content += delta.content
                yield _sse({"type": "token", "content": delta.content})

            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in accumulated_tool_calls:
                        accumulated_tool_calls[idx] = {"id": tc.id or "", "name": "", "arguments": ""}
                    if tc.id:
                        accumulated_tool_calls[idx]["id"] = tc.id
                    if tc.function and tc.function.name:
                        accumulated_tool_calls[idx]["name"] += tc.function.name
                    if tc.function and tc.function.arguments:
                        accumulated_tool_calls[idx]["arguments"] += tc.function.arguments

        if not accumulated_tool_calls:
            final_text = accumulated_content
            break

        api_messages.append({
            "role": "assistant",
            "content": accumulated_content,
            "tool_calls": [
                {
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": tc["arguments"]},
                }
                for tc in accumulated_tool_calls.values()
            ],
        })

        for tc in accumulated_tool_calls.values():
            yield _sse({"type": "tool", "name": tc["name"]})
            try:
                args = json.loads(tc["arguments"] or "{}")
            except json.JSONDecodeError as e:
                tool_output = f"Could not parse arguments: {e}"
            else:
                tool_output = execute_tool(tc["name"], args, ctx)

            api_messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": tool_output,
            })
    else:
        final_text = "I hit my step limit before I could finish. Please ask again with a narrower scope."

    if not final_text.strip():
        final_text = "(empty response)"

    insert_result = supabase.table("messages").insert({
        "chat_id": chat_id,
        "sender_type": "llm",
        "sender_llm_id": llm_id,
        "content": final_text,
    }).execute()
    msg_id = insert_result.data[0]["id"] if insert_result.data else None

    yield _sse({"type": "done", "message_id": msg_id, "content": final_text})


class InviteLLMRequest(BaseModel):
    chat_id: str
    llm_id: str


class AskLLMRequest(BaseModel):
    chat_id: str
    llm_id: str


class PlanAgentRequest(BaseModel):
    chat_id: str


PLANNER_SYSTEM_PROMPT = """You are a planning agent. The user keeps day-by-day task notes in markdown. You produce an ordered execution plan that respects dependencies and surfaces what is doable first.

You will receive a list of dates with markdown content. Each markdown body may contain task lines (`- [ ]` for open tasks, `- [x]` for completed) plus free-form notes.

Your job:
1. Extract every OPEN task across all days. Skip already-checked tasks.
2. Infer dependencies between tasks from the language used. Examples of dependency cues: explicit phrases ("needs X", "after Y", "depends on Z"), implicit ordering (designing UI before coding it, drafting copy before designing a hero around it), and references in adjacent notes.
3. Produce a single ordered plan that:
   - Respects every inferred dependency (a task only appears after its prerequisites)
   - Picks tasks that are immediately ready first, even if that means doing a future day's task before today's last task
   - Prioritizes tasks that unblock the most downstream work

Return JSON ONLY, with this exact shape:
{
  "summary": "<one sentence describing the overall plan>",
  "plan": [
    {
      "date": "YYYY-MM-DD",
      "task": "<exact task text from the markdown, without the leading `- [ ]`>",
      "depends_on": ["<exact texts of prerequisite tasks, if any>"],
      "rationale": "<one short sentence on why this task is at this position>"
    }
  ]
}

If there are no open tasks, return {"summary": "No open tasks found.", "plan": []}.
"""


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
    return StreamingResponse(
        run_agent_stream(body.chat_id, body.llm_id, user_id),
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

    notes_result = (
        supabase.table("daily_notes")
        .select("date, content")
        .eq("chat_id", body.chat_id)
        .order("date")
        .execute()
    )
    notes_rows = notes_result.data or []
    if not notes_rows:
        return {"summary": "No notes for this chat yet.", "plan": []}

    if not any("- [ ]" in (r.get("content") or "") for r in notes_rows):
        return {"summary": "No open tasks found.", "plan": []}

    user_message = "\n\n".join(
        f"## {r['date']}\n{(r.get('content') or '').strip() or '(empty)'}"
        for r in notes_rows
    )

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or "{}"
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Planner returned invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Planner failed: {e}")

    summary = parsed.get("summary", "")
    plan = parsed.get("plan", [])

    if not isinstance(plan, list):
        plan = []
    cleaned_plan = []
    for entry in plan:
        if not isinstance(entry, dict):
            continue
        task_text = entry.get("task")
        if not task_text:
            continue
        cleaned_plan.append({
            "date": entry.get("date", ""),
            "task": task_text,
            "depends_on": entry.get("depends_on") if isinstance(entry.get("depends_on"), list) else [],
            "rationale": entry.get("rationale", ""),
        })

    return {"summary": summary, "plan": cleaned_plan}


# Mount invitation routes (defined in invitations.py, imported here so it sees
# the already-initialized `supabase` client and `get_current_user`).
from invitations import router as invitations_router
app.include_router(invitations_router)
