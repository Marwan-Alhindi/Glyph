"""Message data access."""

from supabase import Client

from dependencies import get_supabase


class MessageRepository:
    def __init__(self, client: Client | None = None) -> None:
        self._db = client or get_supabase()

    def create(
        self,
        chat_id: str,
        sender_type: str,
        content: str,
        *,
        sender_user_id: str | None = None,
        sender_llm_id: str | None = None,
        included_in_context: bool = True,
        attachments: list | None = None,
        kind: str = "chat",
        side_parent_message_id: str | None = None,
    ) -> dict:
        payload: dict = {
            "chat_id": chat_id,
            "sender_type": sender_type,
            "content": content,
            "included_in_context": included_in_context,
            "kind": kind,
        }
        if sender_user_id:
            payload["sender_user_id"] = sender_user_id
        if sender_llm_id:
            payload["sender_llm_id"] = sender_llm_id
        if attachments:
            payload["attachments"] = attachments
        if side_parent_message_id:
            payload["side_parent_message_id"] = side_parent_message_id
        result = self._db.table("messages").insert(payload).execute()
        return result.data[0]

    def create_user_message(
        self,
        chat_id: str,
        sender_user_id: str,
        content: str,
        included_in_context: bool,
        attachments: list,
    ) -> dict:
        """Create a user message and return it joined with invited_llms (for the frontend response shape)."""
        row = self.create(
            chat_id=chat_id,
            sender_type="user",
            content=content,
            sender_user_id=sender_user_id,
            included_in_context=included_in_context,
            attachments=attachments if attachments else None,
        )
        full = (
            self._db.table("messages")
            .select("*, invited_llms(id, display_name, display_number)")
            .eq("id", row["id"])
            .single()
            .execute()
        )
        return full.data

    def get_by_id(self, message_id: str) -> dict | None:
        result = (
            self._db.table("messages").select("*").eq("id", message_id).single().execute()
        )
        return result.data

    def get_created_at(self, message_id: str) -> str | None:
        result = (
            self._db.table("messages")
            .select("created_at")
            .eq("id", message_id)
            .single()
            .execute()
        )
        return (result.data or {}).get("created_at")

    def list_for_context(self, chat_id: str, before_created_at: str | None = None) -> list[dict]:
        """Return all non-deleted messages for the chat, ordered oldest-first.
        If before_created_at is set, only messages strictly before that timestamp."""
        query = (
            self._db.table("messages")
            .select("*, invited_llms(display_name)")
            .eq("chat_id", chat_id)
            .order("created_at")
        )
        if before_created_at:
            query = query.lt("created_at", before_created_at)
        return query.execute().data or []

    def list_by_chat(
        self,
        chat_id: str,
        *,
        sender_type: str | None = None,
        sender_llm_id: str | None = None,
        limit: int = 20,
    ) -> list[dict]:
        query = (
            self._db.table("messages")
            .select("sender_type, sender_llm_id, content, created_at, invited_llms(display_name)")
            .eq("chat_id", chat_id)
            .is_("deleted_at", "null")
            .order("created_at", desc=True)
            .limit(limit)
        )
        if sender_type:
            query = query.eq("sender_type", sender_type)
        if sender_llm_id:
            query = query.eq("sender_llm_id", sender_llm_id)
        return query.execute().data or []

    def update_content(
        self, message_id: str, content: str, chat_id: str, sender_llm_id: str
    ) -> dict | None:
        result = (
            self._db.table("messages")
            .update({"content": content})
            .eq("id", message_id)
            .eq("chat_id", chat_id)
            .eq("sender_llm_id", sender_llm_id)
            .execute()
        )
        return result.data[0] if result.data else None

    def edit(self, message_id: str, content: str, edited_at: str) -> None:
        self._db.table("messages").update(
            {"content": content, "edited_at": edited_at}
        ).eq("id", message_id).execute()

    def soft_delete(self, message_id: str, deleted_at: str) -> None:
        self._db.table("messages").update({"deleted_at": deleted_at}).eq("id", message_id).execute()

    def update_inclusion(self, message_ids: list[str], chat_id: str, included: bool) -> None:
        self._db.table("messages").update({"included_in_context": included}) \
            .in_("id", message_ids).eq("chat_id", chat_id).execute()
