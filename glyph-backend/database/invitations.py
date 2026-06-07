"""Chat invitation data access."""

from supabase import Client

from dependencies import get_supabase


class InvitationRepository:
    def __init__(self, client: Client | None = None) -> None:
        self._db = client or get_supabase()

    def get_pending(self, chat_id: str, email: str) -> list[dict]:
        result = (
            self._db.table("chat_invitations")
            .select("id")
            .eq("chat_id", chat_id)
            .eq("email", email)
            .is_("accepted_at", "null")
            .is_("revoked_at", "null")
            .execute()
        )
        return result.data or []

    def create(
        self,
        chat_id: str,
        email: str,
        token: str,
        invited_by: str,
        expires_at: str,
    ) -> dict:
        result = (
            self._db.table("chat_invitations")
            .insert({
                "chat_id": chat_id,
                "email": email,
                "token": token,
                "invited_by": invited_by,
                "expires_at": expires_at,
            })
            .execute()
        )
        return result.data[0]

    def list_active(self, chat_id: str, now_iso: str) -> list[dict]:
        result = (
            self._db.table("chat_invitations")
            .select("id, chat_id, email, token, invited_by, created_at, expires_at")
            .eq("chat_id", chat_id)
            .is_("accepted_at", "null")
            .is_("revoked_at", "null")
            .gt("expires_at", now_iso)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data or []

    def get_by_id(self, invitation_id: str) -> dict | None:
        result = (
            self._db.table("chat_invitations")
            .select("*")
            .eq("id", invitation_id)
            .single()
            .execute()
        )
        return result.data

    def get_by_token(self, token: str) -> dict | None:
        result = (
            self._db.table("chat_invitations").select("*").eq("token", token).execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    def revoke(self, invitation_id: str, revoked_at: str) -> None:
        self._db.table("chat_invitations").update({"revoked_at": revoked_at}) \
            .eq("id", invitation_id).execute()

    def accept(self, invitation_id: str, accepted_at: str, accepted_by: str) -> None:
        self._db.table("chat_invitations").update({
            "accepted_at": accepted_at,
            "accepted_by": accepted_by,
        }).eq("id", invitation_id).execute()

    def list_pending_for_email(self, email: str, now_iso: str) -> list[dict]:
        result = (
            self._db.table("chat_invitations")
            .select("*")
            .eq("email", email)
            .is_("accepted_at", "null")
            .is_("revoked_at", "null")
            .gt("expires_at", now_iso)
            .execute()
        )
        return result.data or []
