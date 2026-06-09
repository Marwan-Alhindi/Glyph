"""Usage tracking data access."""

from datetime import datetime, timezone

from supabase import Client

from dependencies import get_supabase


def _parse_ts(value: str) -> datetime:
    """Parse a Postgres timestamptz string to an aware UTC datetime."""
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class UsageRepository:
    def __init__(self, client: Client | None = None) -> None:
        self._db = client or get_supabase()

    def get_plan(self, user_id: str) -> str:
        """Effective plan. Payments are one-time monthly: a paid plan lapses to
        free once its subscription period ends, so the user must pay again to
        renew. This is the single source of truth read across the app."""
        result = (
            self._db.table("profiles")
            .select("plan")
            .eq("id", user_id)
            .single()
            .execute()
        )
        plan = (result.data or {}).get("plan") or "free"
        if plan == "free":
            return "free"

        sub = (
            self._db.table("subscriptions")
            .select("current_period_end")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = sub.data or []
        period_end = rows[0].get("current_period_end") if rows else None
        if not period_end or _parse_ts(period_end) < datetime.now(timezone.utc):
            return "free"  # lapsed (or no active period) — back to free
        return plan

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
