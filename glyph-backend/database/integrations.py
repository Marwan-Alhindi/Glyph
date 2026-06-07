"""LLM integration credential data access."""

from supabase import Client

from dependencies import get_supabase


class IntegrationRepository:
    def __init__(self, client: Client | None = None) -> None:
        self._db = client or get_supabase()

    def list_active(self, llm_id: str) -> list[dict]:
        result = (
            self._db.table("llm_integrations")
            .select("id, integration_type, status, created_at")
            .eq("llm_id", llm_id)
            .eq("status", "active")
            .execute()
        )
        return result.data or []

    def upsert(
        self,
        llm_id: str,
        integration_type: str,
        credentials: dict,
        status: str = "active",
    ) -> None:
        self._db.table("llm_integrations").upsert(
            {
                "llm_id": llm_id,
                "integration_type": integration_type,
                "credentials": credentials,
                "status": status,
            },
            on_conflict="llm_id,integration_type",
        ).execute()

    def delete(self, llm_id: str, integration_type: str) -> None:
        self._db.table("llm_integrations").delete() \
            .eq("llm_id", llm_id).eq("integration_type", integration_type).execute()
