"""User and profile data access."""

from fastapi import HTTPException
from supabase import Client

from dependencies import get_supabase


class UserRepository:
    def __init__(self, client: Client | None = None) -> None:
        self._db = client or get_supabase()

    def get_email(self, user_id: str) -> str:
        """Look up a user's email via Supabase auth admin."""
        try:
            resp = self._db.auth.admin.get_user_by_id(user_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to look up user: {e}")
        user = getattr(resp, "user", None)
        if user is None or not getattr(user, "email", None):
            raise HTTPException(status_code=404, detail="User not found")
        return user.email.lower()

    def get_first_name(self, user_id: str) -> str:
        result = (
            self._db.table("profiles").select("first_name").eq("id", user_id).execute()
        )
        if result.data:
            return result.data[0].get("first_name") or "Someone"
        return "Someone"
