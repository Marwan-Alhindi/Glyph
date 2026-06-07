from langchain_core.tools import tool

from agents.tools.context import ToolContext
from dependencies import get_supabase


def make_query_tool(ctx: ToolContext):
    db = get_supabase()

    @tool
    def query_chat_data(query_type: str, limit: int = 20) -> str:
        """Query data from this chat. Useful for summarising history or retrieving planner notes.

        query_type options:
          'recent_messages'  — last N messages from all participants
          'user_messages'    — only human-sent messages
          'my_messages'      — only your own past replies
          'daily_notes'      — all planner daily notes for this chat
        limit: max rows to return (default 20, max 100)
        """
        limit = max(1, min(limit, 100))
        try:
            if query_type == "recent_messages":
                rows = (
                    db.table("messages")
                    .select("sender_type, sender_llm_id, content, created_at, invited_llms(display_name)")
                    .eq("chat_id", ctx.chat_id)
                    .is_("deleted_at", "null")
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                    .data or []
                )
                lines = []
                for r in reversed(rows):
                    name = (r.get("invited_llms") or {}).get("display_name") or "User" if r["sender_type"] == "llm" else "User"
                    lines.append(f"[{r['created_at'][:16]}] {name}: {(r['content'] or '')[:200]}")
                return "\n".join(lines) or "No messages found."

            elif query_type == "user_messages":
                rows = (
                    db.table("messages")
                    .select("content, created_at")
                    .eq("chat_id", ctx.chat_id)
                    .eq("sender_type", "user")
                    .is_("deleted_at", "null")
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                    .data or []
                )
                return "\n".join(
                    f"[{r['created_at'][:16]}] {(r['content'] or '')[:200]}" for r in reversed(rows)
                ) or "No user messages found."

            elif query_type == "my_messages":
                rows = (
                    db.table("messages")
                    .select("content, created_at")
                    .eq("chat_id", ctx.chat_id)
                    .eq("sender_type", "llm")
                    .eq("sender_llm_id", ctx.sender_llm_id)
                    .is_("deleted_at", "null")
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                    .data or []
                )
                return "\n".join(
                    f"[{r['created_at'][:16]}] {(r['content'] or '')[:200]}" for r in reversed(rows)
                ) or "No messages from you yet."

            elif query_type == "daily_notes":
                rows = (
                    db.table("daily_notes")
                    .select("date, content")
                    .eq("chat_id", ctx.chat_id)
                    .order("date", desc=True)
                    .limit(limit)
                    .execute()
                    .data or []
                )
                return "\n\n".join(
                    f"=== {r['date']} ===\n{r['content'] or '(empty)'}" for r in rows
                ) or "No daily notes yet."

            else:
                return f"Unknown query_type '{query_type}'. Options: recent_messages, user_messages, my_messages, daily_notes."
        except Exception as e:
            return f"Query failed: {e}"

    return query_chat_data
