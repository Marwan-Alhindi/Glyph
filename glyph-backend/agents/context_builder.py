"""Build the message history an invited LLM is allowed to see.

Honors llm_connections: a model only sees user messages if connected to the
user, and only sees other LLMs' messages for those it's connected to.

Returns LangChain BaseMessage objects consumed directly by the chat agent.
"""

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from database.llms import LLMRepository
from database.messages import MessageRepository


def build_context_messages(
    chat_id: str,
    llm_id: str,
    system_prompt: str,
    up_to_message_id: str | None = None,
    include_message_id: str | None = None,
    force_include_message_ids: set[str] | None = None,
    cache_system_prompt: bool = False,
) -> list[BaseMessage]:
    """Return the conversation history as LangChain messages.

    up_to_message_id: truncate to messages strictly before this id (regenerate flow).
    include_message_id: force a side-ask message visible even if included_in_context=false.
    force_include_message_ids: bypass connection filter for these message ids (delegation).
    cache_system_prompt: add Anthropic cache_control breakpoint to the system prompt.
    """
    llm_repo = LLMRepository()
    msg_repo = MessageRepository()

    connections = llm_repo.get_connections(llm_id)
    connected_to_user = any(c["target_type"] == "user" for c in connections)
    connected_llm_ids = [c["target_llm_id"] for c in connections if c["target_type"] == "llm"]

    cutoff_created_at: str | None = None
    if up_to_message_id:
        cutoff_created_at = msg_repo.get_created_at(up_to_message_id)

    chat_messages = msg_repo.list_for_context(chat_id, before_created_at=cutoff_created_at)

    messages: list[BaseMessage] = []
    if system_prompt:
        if cache_system_prompt:
            messages.append(SystemMessage(content=[{
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }]))
        else:
            messages.append(SystemMessage(content=system_prompt))

    force_visible_ids: set[str] = set()
    if include_message_id:
        force_visible_ids.add(include_message_id)
    if force_include_message_ids:
        force_visible_ids |= force_include_message_ids

    for msg in chat_messages:
        force_visible = msg.get("id") in force_visible_ids
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
            file_hints.append(
                f"[Attached file: {name} — use the read_file tool with URL {url!r} to read its contents]"
            )

    if not image_parts and not file_hints:
        return HumanMessage(content=text)

    full_text = text
    if file_hints:
        full_text = "\n".join(file_hints) + ("\n\n" + text if text else "")

    if image_parts:
        content: list = image_parts + [{"type": "text", "text": full_text}]
        return HumanMessage(content=content)

    return HumanMessage(content=full_text)
