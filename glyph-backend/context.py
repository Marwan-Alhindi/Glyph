"""Build the message history an invited LLM is allowed to see.

Honors `llm_connections`: a model only sees user messages if it's connected
to the user, and only sees other LLMs' messages for those it's connected to.

Returns LangChain `BaseMessage` objects so the chat agent (built on
`langchain.agents.create_agent`) can consume them directly.
"""

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from config import supabase


def build_context_messages(
    chat_id: str,
    llm_id: str,
    system_prompt: str,
    up_to_message_id: str | None = None,
    include_message_id: str | None = None,
    force_include_message_ids: set[str] | None = None,
) -> list[BaseMessage]:
    """Return the conversation history as LangChain messages.

    If `up_to_message_id` is set, the history is truncated to messages
    strictly before that one (and the message itself is excluded). Used for
    regenerating an existing AI reply without leaking its old content into
    the new context.

    `include_message_id` keeps a side-ask message visible even when
    `included_in_context=false`. `force_include_message_id` additionally
    bypasses the connection filter for one explicit trigger message, which
    lets delegated LLMs see the handoff even when they are not connected to
    the delegating LLM's full history.
    """
    conn_result = (
        supabase.table("llm_connections")
        .select("*")
        .eq("llm_id", llm_id)
        .execute()
    )
    connections = conn_result.data or []
    connected_to_user = any(c["target_type"] == "user" for c in connections)
    connected_llm_ids = [c["target_llm_id"] for c in connections if c["target_type"] == "llm"]

    cutoff_created_at: str | None = None
    if up_to_message_id:
        cutoff_row = (
            supabase.table("messages")
            .select("created_at")
            .eq("id", up_to_message_id)
            .single()
            .execute()
        )
        cutoff_created_at = (cutoff_row.data or {}).get("created_at")

    msgs_query = (
        supabase.table("messages")
        .select("*, invited_llms(display_name)")
        .eq("chat_id", chat_id)
        .order("created_at")
    )
    if cutoff_created_at:
        msgs_query = msgs_query.lt("created_at", cutoff_created_at)
    chat_messages = msgs_query.execute().data or []

    messages: list[BaseMessage] = []
    if system_prompt:
        messages.append(SystemMessage(content=system_prompt))

    force_visible_ids: set[str] = set()
    if include_message_id:
        force_visible_ids.add(include_message_id)
    if force_include_message_ids:
        force_visible_ids |= force_include_message_ids

    for msg in chat_messages:
        force_visible = msg.get("id") in force_visible_ids
        # Soft-deleted messages are hidden from LLM context — the UI shows a
        # tombstone to humans, but the model should regenerate as if the
        # message never existed.
        if msg.get("deleted_at"):
            continue
        if msg.get("included_in_context") is False and not force_visible:
            continue
        if msg["sender_type"] == "llm" and msg["sender_llm_id"] == llm_id:
            messages.append(AIMessage(content=msg["content"]))
        elif msg["sender_type"] == "user" and (connected_to_user or force_visible):
            messages.append(_build_human_message(msg))
        elif msg["sender_type"] == "llm" and (msg["sender_llm_id"] in connected_llm_ids or force_visible):
            sender_name = (msg.get("invited_llms") or {}).get("display_name") or "LLM"
            messages.append(HumanMessage(content=f"{sender_name}: {msg['content']}"))
    return messages


def _build_human_message(msg: dict) -> HumanMessage:
    """Build a HumanMessage, injecting image attachments as multimodal content
    blocks and appending non-image file references as text hints."""
    text = msg.get("content") or ""
    attachments = msg.get("attachments") or []

    if not attachments:
        return HumanMessage(content=text)

    image_parts = []
    file_hints = []
    for a in attachments:
        mime = (a.get("mime_type") or "").lower()
        url = a.get("url") or ""
        name = a.get("filename") or url
        if mime.startswith("image/"):
            image_parts.append({"type": "image_url", "image_url": {"url": url}})
        else:
            file_hints.append(f"[Attached file: {name} — use the read_file tool with URL {url!r} to read its contents]")

    if not image_parts and not file_hints:
        return HumanMessage(content=text)

    full_text = text
    if file_hints:
        full_text = "\n".join(file_hints) + ("\n\n" + text if text else "")

    if image_parts:
        content: list = image_parts + [{"type": "text", "text": full_text}]
        return HumanMessage(content=content)

    return HumanMessage(content=full_text)
