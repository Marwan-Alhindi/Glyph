from dependencies import get_supabase


class DailyNotesRepository:
    def __init__(self, client=None):
        self._db = client or get_supabase()

    def list_by_chat(self, chat_id: str) -> list[dict]:
        return (
            self._db.table("daily_notes")
            .select("date, content")
            .eq("chat_id", chat_id)
            .order("date")
            .execute()
            .data or []
        )
