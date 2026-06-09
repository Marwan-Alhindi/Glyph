"""Payment order + subscription data access (KAN-10).

Two tables:
  payment_orders  — one row per checkout attempt; the idempotency/audit log.
  subscriptions   — current paid state per user (one row each).

`profiles.plan` (read by usage.py) is the effective entitlement and is updated
in lockstep with the subscription here.
"""

from datetime import datetime

from supabase import Client

from dependencies import get_supabase


class SubscriptionRepository:
    def __init__(self, client: Client | None = None) -> None:
        self._db = client or get_supabase()

    # --- payment_orders -------------------------------------------------

    def create_order(
        self, *, reference: str, user_id: str, plan: str, amount: str, currency: str
    ) -> None:
        self._db.table("payment_orders").insert(
            {
                "order_reference": reference,
                "user_id": user_id,
                "plan": plan,
                "amount": amount,
                "currency": currency,
                "status": "initiated",
            }
        ).execute()

    def set_noon_order_id(self, reference: str, noon_order_id: str) -> None:
        self._db.table("payment_orders").update(
            {"noon_order_id": noon_order_id}
        ).eq("order_reference", reference).execute()

    def get_order(self, reference: str) -> dict | None:
        result = (
            self._db.table("payment_orders")
            .select("*")
            .eq("order_reference", reference)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    def mark_order(self, reference: str, status: str) -> None:
        self._db.table("payment_orders").update({"status": status}).eq(
            "order_reference", reference
        ).execute()

    # --- subscriptions + entitlement ------------------------------------

    def activate(
        self, *, user_id: str, plan: str, period_end: datetime, card_token: str | None
    ) -> None:
        """Upsert the subscription to active and flip the user's effective plan.
        Idempotent: replaying the same paid order just re-writes the same state."""
        row = {
            "user_id": user_id,
            "plan": plan,
            "status": "active",
            "current_period_end": period_end.isoformat(),
        }
        if card_token:
            row["noon_card_token"] = card_token
        self._db.table("subscriptions").upsert(row, on_conflict="user_id").execute()
        self._db.table("profiles").update({"plan": plan}).eq("id", user_id).execute()

    def get_subscription(self, user_id: str) -> dict | None:
        result = (
            self._db.table("subscriptions")
            .select("plan, status, current_period_end")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None
