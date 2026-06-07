"""Usage tracking data access."""

from supabase import Client

from dependencies import get_supabase


class UsageRepository:
    def __init__(self, client: Client | None = None) -> None:
        self._db = client or get_supabase()

    def get_plan(self, user_id: str) -> str:
        result = (
            self._db.table("profiles")
            .select("plan")
            .eq("id", user_id)
            .single()
            .execute()
        )
        return (result.data or {}).get("plan") or "free"

    def get_tokens_used(self, user_id: str, period: str) -> int:
        result = (
            self._db.table("usage_tracking")
            .select("tokens_used")
            .eq("user_id", user_id)
            .eq("period_start", period)
            .execute()
        )
        rows = result.data or []
        return rows[0]["tokens_used"] if rows else 0

    def increment_tokens(self, user_id: str, period: str, tokens: int) -> None:
        self._db.rpc(
            "increment_usage",
            {"p_user_id": user_id, "p_period": period, "p_tokens": tokens},
        ).execute()
