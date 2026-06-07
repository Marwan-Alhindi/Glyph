"""Chat and participant data access."""

from supabase import Client

from dependencies import get_supabase


class ChatRepository:
    def __init__(self, client: Client | None = None) -> None:
        self._db = client or get_supabase()

    # ------------------------------------------------------------------ chats

    def create(self, name: str, created_by: str) -> dict:
        result = (
            self._db.table("chats")
            .insert({"name": name, "created_by": created_by})
            .execute()
        )
        return result.data[0]

    def rename(self, chat_id: str, name: str) -> None:
        self._db.table("chats").update({"name": name}).eq("id", chat_id).execute()

    def get_name(self, chat_id: str) -> str | None:
        result = (
            self._db.table("chats").select("name").eq("id", chat_id).single().execute()
        )
        return (result.data or {}).get("name")

    def count_owned_by_user(self, user_id: str) -> int:
        result = (
            self._db.table("chat_participants")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .eq("role", "owner")
            .execute()
        )
        return result.count or 0

    def count_human_participants(self, chat_id: str) -> int:
        result = (
            self._db.table("chat_participants")
            .select("id", count="exact")
            .eq("chat_id", chat_id)
            .execute()
        )
        return result.count or 0

    # ------------------------------------------------------------- participants

    def add_participant(self, chat_id: str, user_id: str, role: str = "member") -> dict:
        result = (
            self._db.table("chat_participants")
            .insert({"chat_id": chat_id, "user_id": user_id, "role": role})
            .execute()
        )
        return (result.data or [{}])[0]

    def get_participant(self, chat_id: str, user_id: str) -> dict | None:
        result = (
            self._db.table("chat_participants")
            .select("*")
            .eq("chat_id", chat_id)
            .eq("user_id", user_id)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    def get_participant_by_id(self, participant_id: str) -> dict | None:
        result = (
            self._db.table("chat_participants")
            .select("*")
            .eq("id", participant_id)
            .single()
            .execute()
        )
        return result.data

    def list_participants_with_profiles(self, chat_id: str) -> list[dict]:
        result = (
            self._db.table("chat_participants")
            .select("user_id, role, joined_at, profiles(id, first_name, last_name)")
            .eq("chat_id", chat_id)
            .execute()
        )
        return result.data or []

    def update_pin(self, chat_id: str, user_id: str, pinned_at: str | None) -> None:
        self._db.table("chat_participants").update({"pinned_at": pinned_at}) \
            .eq("chat_id", chat_id).eq("user_id", user_id).execute()

    def remove_participant(self, chat_id: str, user_id: str) -> None:
        self._db.table("chat_participants").delete() \
            .eq("chat_id", chat_id).eq("user_id", user_id).execute()

    def is_owner(self, chat_id: str, user_id: str) -> bool:
        result = (
            self._db.table("chat_participants")
            .select("id")
            .eq("chat_id", chat_id)
            .eq("user_id", user_id)
            .eq("role", "owner")
            .execute()
        )
        return bool(result.data)

    def update_can_invite(self, participant_id: str, can_invite: bool) -> None:
        self._db.table("chat_participants").update({"can_invite": can_invite}) \
            .eq("id", participant_id).execute()

    # ----------------------------------------------------------------- profiles

    def get_profile_first_name(self, user_id: str) -> str:
        result = (
            self._db.table("profiles").select("first_name").eq("id", user_id).execute()
        )
        if result.data:
            return result.data[0].get("first_name") or "Someone"
        return "Someone"
