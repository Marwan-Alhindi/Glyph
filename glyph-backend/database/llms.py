"""Invited LLM and connection data access."""

from supabase import Client

from dependencies import get_supabase


class LLMRepository:
    def __init__(self, client: Client | None = None) -> None:
        self._db = client or get_supabase()

    def get_by_id(self, llm_id: str) -> dict | None:
        result = (
            self._db.table("invited_llms").select("*").eq("id", llm_id).single().execute()
        )
        return result.data

    def get_chat_id(self, llm_id: str) -> str | None:
        result = (
            self._db.table("invited_llms")
            .select("chat_id")
            .eq("id", llm_id)
            .maybe_single()
            .execute()
        )
        return (result.data or {}).get("chat_id")

    def list_by_chat(self, chat_id: str, exclude_id: str | None = None) -> list[dict]:
        query = (
            self._db.table("invited_llms")
            .select("id, display_name")
            .eq("chat_id", chat_id)
        )
        if exclude_id:
            query = query.neq("id", exclude_id)
        return query.execute().data or []

    def list_by_chat_full(self, chat_id: str) -> list[dict]:
        result = (
            self._db.table("invited_llms")
            .select("id, display_name, display_number, model_instruct, invited_by, created_at")
            .eq("chat_id", chat_id)
            .order("display_number")
            .execute()
        )
        return result.data or []

    def get_next_display_number(self, chat_id: str) -> int:
        rows = (
            self._db.table("invited_llms")
            .select("display_number")
            .eq("chat_id", chat_id)
            .execute()
            .data or []
        )
        return max((r.get("display_number") or 0) for r in rows) + 1 if rows else 1

    def create(
        self,
        chat_id: str,
        display_name: str,
        model_instruct: str,
        model_type: str,
        display_number: int,
        invited_by: str,
    ) -> dict:
        result = (
            self._db.table("invited_llms")
            .insert({
                "chat_id": chat_id,
                "display_name": display_name,
                "model_instruct": model_instruct,
                "model_type": model_type,
                "display_number": display_number,
                "invited_by": invited_by,
            })
            .execute()
        )
        return result.data[0]

    def create_connections(self, conn_rows: list[dict]) -> list[dict]:
        result = self._db.table("llm_connections").insert(conn_rows).execute()
        return result.data or []

    def get_connections(self, llm_id: str) -> list[dict]:
        result = (
            self._db.table("llm_connections").select("*").eq("llm_id", llm_id).execute()
        )
        return result.data or []

    def list_connections_for_llms(self, llm_ids: list[str]) -> list[dict]:
        if not llm_ids:
            return []
        result = (
            self._db.table("llm_connections")
            .select("id, llm_id, target_type, target_llm_id")
            .in_("llm_id", llm_ids)
            .execute()
        )
        return result.data or []

    def validate_llm_ids_in_chat(self, chat_id: str, llm_ids: list[str]) -> set[str]:
        if not llm_ids:
            return set()
        result = (
            self._db.table("invited_llms")
            .select("id")
            .eq("chat_id", chat_id)
            .in_("id", llm_ids)
            .execute()
            .data or []
        )
        return {r["id"] for r in result}
