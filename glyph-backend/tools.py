"""Agent tool definitions and executors.

Tool functions take a `ctx` dict with:
  chat_id, calling_llm_id, user_id, depth,
  supabase, run_agent, generate_join_message

This module does not import from main.py; dependencies are injected via ctx
to avoid circular imports.
"""

import os
import re
import uuid

MAX_MENTION_DEPTH = 3

PDFS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pdfs")
PUBLIC_API_BASE = os.getenv("PUBLIC_API_BASE", "http://localhost:8000").rstrip("/")


TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for current information. Use when the answer depends on recent events or facts outside your training data.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query."}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mention_llm",
            "description": "Send a message to another LLM already in this chat. That LLM will see your message and respond in the chat. Use to delegate, consult, or hand off work.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_display_name": {"type": "string", "description": "display_name of an LLM already in this chat."},
                    "content": {"type": "string", "description": "The message to send them."},
                },
                "required": ["target_display_name", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_pdf",
            "description": "Generate a real downloadable PDF from text/markdown content. Use this when the user asks you to create, export, or download a PDF. Returns a URL you MUST include in your reply as a markdown link so the user can download it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Title shown at the top of the PDF and used for the filename."},
                    "content": {"type": "string", "description": "The body of the PDF. Plain text with blank lines between paragraphs; supports basic inline markdown (**bold**, *italic*)."},
                },
                "required": ["title", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "invite_llm",
            "description": "Invite a new specialist LLM into this chat with a persona and instructions. Use when the task needs a dedicated sub-agent you can then delegate to with mention_llm.",
            "parameters": {
                "type": "object",
                "properties": {
                    "display_name": {"type": "string", "description": "Unique name for the new LLM in this chat."},
                    "instructions": {"type": "string", "description": "System prompt describing their role and behavior."},
                    "connect_to_user": {"type": "boolean", "description": "Whether the new LLM can see user messages. Default true."},
                },
                "required": ["display_name", "instructions"],
            },
        },
    },
]


def run_web_search(ctx, query):
    try:
        from ddgs import DDGS
        results = DDGS().text(query, max_results=5)
    except Exception as e:
        return f"Search failed: {e}"

    if not results:
        return "No results."

    lines = []
    for r in results:
        title = r.get("title", "")
        href = r.get("href", "")
        body = (r.get("body") or "")[:300]
        lines.append(f"- {title} ({href}): {body}")
    return "\n".join(lines)


def run_mention_llm(ctx, target_display_name, content):
    supabase = ctx["supabase"]
    chat_id = ctx["chat_id"]
    calling_llm_id = ctx["calling_llm_id"]
    user_id = ctx["user_id"]
    depth = ctx["depth"]

    target_result = (
        supabase.table("invited_llms")
        .select("id, display_name")
        .eq("chat_id", chat_id)
        .eq("display_name", target_display_name)
        .execute()
    )
    if not target_result.data:
        return f"No LLM named '{target_display_name}' is in this chat."
    target = target_result.data[0]

    if target["id"] == calling_llm_id:
        return "Cannot mention yourself."

    supabase.table("messages").insert({
        "chat_id": chat_id,
        "sender_type": "llm",
        "sender_llm_id": calling_llm_id,
        "content": f"@{target_display_name} {content}",
    }).execute()

    if depth >= MAX_MENTION_DEPTH:
        return f"Message sent to {target_display_name}, but mention depth limit reached — they will not auto-reply."

    try:
        ctx["run_agent"](
            chat_id=chat_id,
            llm_id=target["id"],
            user_id=user_id,
            depth=depth + 1,
        )
    except Exception as e:
        return f"Message sent, but {target_display_name} failed to respond: {e}"

    return f"Message delivered to {target_display_name}. They have replied in the chat."


def run_invite_llm(ctx, display_name, instructions, connect_to_user=True):
    supabase = ctx["supabase"]
    chat_id = ctx["chat_id"]
    calling_llm_id = ctx["calling_llm_id"]
    user_id = ctx["user_id"]

    existing = (
        supabase.table("invited_llms")
        .select("id, display_name, display_number")
        .eq("chat_id", chat_id)
        .execute()
    )
    rows = existing.data or []
    for row in rows:
        if (row.get("display_name") or "").lower() == display_name.lower():
            return f"An LLM named '{display_name}' already exists in this chat. Pick a different name."

    display_number = max((row.get("display_number") or 0 for row in rows), default=0) + 1

    insert_result = supabase.table("invited_llms").insert({
        "chat_id": chat_id,
        "display_name": display_name,
        "model_type": "openai",
        "model_instruct": instructions,
        "display_number": display_number,
        "invited_by": user_id,
    }).execute()
    new_llm = insert_result.data[0] if insert_result.data else None
    if not new_llm:
        return "Failed to create LLM."

    connection_rows = []
    if connect_to_user:
        connection_rows.append({"llm_id": new_llm["id"], "target_type": "user", "target_llm_id": None})
    # Two-way with the inviter so they can converse via mention_llm.
    connection_rows.append({"llm_id": new_llm["id"], "target_type": "llm", "target_llm_id": calling_llm_id})
    connection_rows.append({"llm_id": calling_llm_id, "target_type": "llm", "target_llm_id": new_llm["id"]})

    supabase.table("llm_connections").insert(connection_rows).execute()

    try:
        join_text = ctx["generate_join_message"](display_name)
    except Exception:
        join_text = f"{display_name} has joined the chat."

    supabase.table("messages").insert({
        "chat_id": chat_id,
        "sender_type": "llm",
        "sender_llm_id": new_llm["id"],
        "content": join_text,
        "kind": "join",
    }).execute()

    return f"Invited {display_name} (#{display_number}). They are in the chat and connected to you — you can now use mention_llm to talk to them."


def run_create_pdf(ctx, title, content):
    try:
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    except Exception as e:
        return f"PDF generation unavailable (reportlab not installed): {e}"

    os.makedirs(PDFS_DIR, exist_ok=True)

    safe_title = re.sub(r"[^A-Za-z0-9_-]+", "-", title).strip("-") or "document"
    filename = f"{safe_title}-{uuid.uuid4().hex[:8]}.pdf"
    path = os.path.join(PDFS_DIR, filename)

    styles = getSampleStyleSheet()
    story = [Paragraph(title, styles["Title"]), Spacer(1, 12)]
    for block in re.split(r"\n\s*\n", content.strip()):
        if not block:
            continue
        # reportlab Paragraph treats <br/> as a line break; single \n -> <br/>.
        html = block.replace("\n", "<br/>")
        # Convert **bold** and *italic* so the LLM's markdown survives.
        html = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", html)
        html = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<i>\1</i>", html)
        story.append(Paragraph(html, styles["BodyText"]))
        story.append(Spacer(1, 8))

    try:
        SimpleDocTemplate(path, pagesize=LETTER).build(story)
    except Exception as e:
        return f"PDF generation failed: {e}"

    url = f"{PUBLIC_API_BASE}/pdfs/{filename}"
    return f"PDF created at {url}. Include this URL in your reply as a markdown link like [Download {title}]({url}) so the user can download it."


TOOL_DISPATCH = {
    "web_search": run_web_search,
    "mention_llm": run_mention_llm,
    "invite_llm": run_invite_llm,
    "create_pdf": run_create_pdf,
}


def execute_tool(name, args, ctx):
    fn = TOOL_DISPATCH.get(name)
    if not fn:
        return f"Unknown tool: {name}"
    try:
        return fn(ctx=ctx, **args)
    except TypeError as e:
        return f"Tool {name} called with bad arguments: {e}"
    except Exception as e:
        return f"Tool {name} failed: {e}"
