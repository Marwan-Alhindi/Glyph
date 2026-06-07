import re

from langchain_core.tools import tool

from agents.tools.context import Delegation, ToolContext
from dependencies import get_supabase


def normalize_llm_name(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").lstrip("@").strip()).lower()


def make_delegate_tool(ctx: ToolContext):
    db = get_supabase()

    @tool
    def delegate(target_name: str, task: str) -> str:
        """Hand off a follow-up task to another LLM in this chat.

        Use this only after you have completed your own part and the right
        next step is for a different LLM to act on your output (e.g. you're a
        researcher producing material for a designer). Only use it when
        delegation is genuinely useful — a casual mention of another LLM's
        name is not a reason to delegate. The user will not see this handoff
        message in the normal timeline, so your final reply should contain
        your own finished outcome, not narration about the handoff.

        Args:
            target_name: Display name of the target LLM, e.g. "Designer".
                Case-insensitive. Don't include the leading '@'.
            task: A clear, self-contained instruction the target LLM should
                act on. Include the completed facts, summary, findings, or
                context from your work that the target will need.
        """
        display_target = target_name.lstrip("@").strip()
        normalized = normalize_llm_name(target_name)
        target_id = ctx.other_llms_by_name.get(normalized)
        if not target_id:
            available = sorted(ctx.other_llms_by_name.keys())
            if not available:
                return "There are no other LLMs in this chat to delegate to."
            return f"No LLM named {target_name!r} in this chat. Available: {available}"

        task_text = task.strip()
        if not task_text:
            return "Delegation skipped: the task was empty."

        if any(d.target_llm_id == target_id and d.task == task_text for d in ctx.delegations):
            return f"Delegation to @{display_target} was already queued for this response."

        try:
            insert_result = db.table("messages").insert({
                "chat_id": ctx.chat_id,
                "sender_type": "llm",
                "sender_llm_id": ctx.sender_llm_id,
                "content": f"-> @{display_target}: {task_text}",
                "kind": "delegation",
            }).execute()
        except Exception as e:
            return f"Delegation failed: {e}"

        message_id = insert_result.data[0].get("id") if insert_result.data else None
        ctx.delegations.append(Delegation(
            target_llm_id=target_id,
            target_name=display_target,
            task=task_text,
            message_id=message_id,
        ))

        return (
            f"Delegation to @{display_target} queued. "
            "Now give the user your final outcome without describing the handoff."
        )

    return delegate
