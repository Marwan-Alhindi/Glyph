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
        self,
        *,
        user_id: str,
        plan: str,
        period_end: datetime,
        card_token: str | None,
        subscription_id: str | None = None,
    ) -> None:
        """Upsert the subscription to active and flip the user's effective plan.
        Idempotent: replaying the same paid order just re-writes the same state."""
        row = {
            "user_id": user_id,
            "plan": plan,
            "status": "active",
            "cancel_at_period_end": False,
            "current_period_end": period_end.isoformat(),
        }
        if card_token:
            row["noon_card_token"] = card_token
        if subscription_id:
            row["noon_subscription_id"] = subscription_id
        self._db.table("subscriptions").upsert(row, on_conflict="user_id").execute()
        self._db.table("profiles").update({"plan": plan}).eq("id", user_id).execute()

    def get_subscription(self, user_id: str) -> dict | None:
        result = (
            self._db.table("subscriptions")
            .select("plan, status, current_period_end, cancel_at_period_end, noon_subscription_id")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    def mark_cancel_at_period_end(self, user_id: str) -> None:
        """Flag the subscription to not renew. Access is kept until
        current_period_end, after which it reverts to free."""
        self._db.table("subscriptions").update(
            {"status": "canceled", "cancel_at_period_end": True}
        ).eq("user_id", user_id).execute()

    def latest_paid_order(self, user_id: str) -> dict | None:
        """The most recent paid order for a user — its noon_order_id is the
        anchor Noon needs to cancel the recurring subscription."""
        result = (
            self._db.table("payment_orders")
            .select("noon_order_id, plan")
            .eq("user_id", user_id)
            .eq("status", "paid")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    def extend_period(self, subscription_id: str, period_end: datetime) -> bool:
        """Advance an active subscription's period after a renewal charge.
        Matches on Noon's subscription identifier (the webhook's anchor).
        Returns True if a row was updated."""
        result = (
            self._db.table("subscriptions")
            .update({"current_period_end": period_end.isoformat(), "status": "active"})
            .eq("noon_subscription_id", subscription_id)
            .execute()
        )
        return bool(result.data)

    def revert_to_free(self, user_id: str) -> None:
        """Drop the user to the free plan (period lapsed / canceled)."""
        self._db.table("subscriptions").update({"status": "canceled"}).eq(
            "user_id", user_id
        ).execute()
        self._db.table("profiles").update({"plan": "free"}).eq("id", user_id).execute()
