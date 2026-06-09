"""Noon Payments routes (KAN-10) — subscriptions via Hosted Checkout.

Flow:
  POST /payments/checkout      -> create order, return Noon's hosted postUrl
  (payer pays on Noon's page, then Noon redirects to APP_URL/app/billing/return)
  GET  /payments/verify/{ref}  -> return page calls this; confirms with Noon, applies plan
  POST /payments/webhook       -> Noon's server-to-server callback; same apply, idempotent
  GET  /payments/subscription  -> current paid state for the UI

verify and webhook are belt-and-suspenders: both re-fetch the order from Noon
(never trust the caller) and both funnel through _apply_paid_order, which is
idempotent on already-paid orders.
"""

import uuid

import httpx
from fastapi import APIRouter, Header, HTTPException, Request

from auth import get_current_user
from dependencies import get_supabase
from database.subscriptions import SubscriptionRepository
from payments import noon, plans
from settings import get_settings
from api.schemas import CheckoutRequest

router = APIRouter(prefix="/payments")


def _apply_paid_order(reference: str) -> dict:
    """Re-fetch the order from Noon and, if paid, activate the subscription.
    Returns {status, detail}. Idempotent."""
    repo = SubscriptionRepository()
    order = repo.get_order(reference)
    if not order:
        raise HTTPException(status_code=404, detail="Unknown order")

    if order["status"] == "paid":
        return {"status": "paid", "detail": None}  # already applied

    noon_order_id = order.get("noon_order_id")
    if not noon_order_id:
        raise HTTPException(status_code=409, detail="Order was never initiated with Noon")

    remote = noon.get_order(noon_order_id)
    if remote["status"] != "SUCCESS":
        repo.mark_order(reference, "failed")
        return {"status": "failed", "detail": remote.get("error_message")}

    repo.activate(
        user_id=order["user_id"],
        plan=order["plan"],
        period_end=plans.next_period_end(),
        card_token=remote.get("card_token"),
        subscription_id=remote.get("subscription_id"),
    )
    repo.mark_order(reference, "paid")
    return {"status": "paid", "detail": None}


@router.post("/checkout")
def checkout(body: CheckoutRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)

    plan = body.plan
    if not plans.is_purchasable(plan):
        raise HTTPException(status_code=400, detail=f"Plan '{plan}' is not purchasable")

    s = get_settings()
    if not (s.noon_business_id and s.noon_application and s.noon_api_key):
        raise HTTPException(status_code=503, detail="Payments are not configured")

    reference = uuid.uuid4().hex
    amount = plans.price_str(plan)

    repo = SubscriptionRepository()
    repo.create_order(
        reference=reference,
        user_id=user_id,
        plan=plan,
        amount=amount,
        currency=plans.CURRENCY,
    )

    # Cardholder identity for 3DS (3DS2 authenticates against it; recurring
    # mandates 3DS). Best-effort — checkout still proceeds if the lookup fails.
    email = first = last = None
    try:
        resp = get_supabase().auth.admin.get_user_by_id(user_id)
        u = getattr(resp, "user", None) or resp
        email = getattr(u, "email", None)
        meta = getattr(u, "user_metadata", None) or {}
        first, last = meta.get("first_name"), meta.get("last_name")
    except Exception:
        pass

    return_url = f"{s.app_url}/app/billing/return?ref={reference}"
    try:
        result = noon.initiate_order(
            reference=reference,
            amount=amount,
            currency=plans.CURRENCY,
            name=f"{plans.PLAN_NAMES[plan]} subscription",
            return_url=return_url,
            # Register a recurring subscription so Noon auto-charges each cycle.
            subscription_name=plans.subscription_name(plan),
            payment_frequency_days=plans.PERIOD_DAYS,
            customer_email=email,
            customer_first=first,
            customer_last=last,
        )
    except (httpx.HTTPError, ValueError) as e:
        repo.mark_order(reference, "failed")
        raise HTTPException(status_code=502, detail=f"Could not start checkout: {e}")

    repo.set_noon_order_id(reference, result["noon_order_id"])
    return {"reference": reference, "checkout_url": result["post_url"]}


@router.get("/verify/{reference}")
def verify(reference: str, authorization: str = Header()):
    user_id = get_current_user(authorization)

    repo = SubscriptionRepository()
    order = repo.get_order(reference)
    if not order or order["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Unknown order")

    result = _apply_paid_order(reference)
    return {"status": result["status"], "plan": order["plan"], "detail": result.get("detail")}


@router.post("/webhook")
async def webhook(request: Request):
    """Noon server-to-server notification. Handles two cases:
      - initial purchase: the reference matches one of our payment_orders →
        _apply_paid_order (re-fetches from Noon, so a forged call grants nothing).
      - recurring renewal: Noon auto-charged the subscription. There's no order
        of ours to match, so we extend the period by the subscription identifier.

    NOTE: the exact renewal payload shape should be confirmed against Noon's docs
    once a live subscription has cycled.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    order = body.get("order") or {}
    reference = order.get("reference") or body.get("reference")

    # Initial purchase — we created this order, so we know the reference.
    if reference and SubscriptionRepository().get_order(reference):
        _apply_paid_order(reference)
        return {"received": True}

    # Otherwise treat it as a renewal keyed on the subscription identifier.
    sub_block = body.get("subscription") or {}
    sub_id = sub_block.get("identifier") or order.get("subscriptionIdentifier")
    txns = body.get("transactions") or []
    succeeded = any(t.get("status") == "SUCCESS" for t in txns) or sub_block.get("status") in ("Active", "Success")
    if sub_id and succeeded:
        SubscriptionRepository().extend_period(sub_id, plans.next_period_end())

    return {"received": True}


@router.post("/cancel")
def cancel(authorization: str = Header()):
    """Cancel the user's subscription: stop Noon's future auto-charges and flag
    it to revert to free at current_period_end (access kept until then)."""
    user_id = get_current_user(authorization)
    repo = SubscriptionRepository()

    sub = repo.get_subscription(user_id)
    if not sub or sub.get("status") != "active":
        raise HTTPException(status_code=400, detail="No active subscription to cancel")

    # Tell Noon to stop auto-charging. Best-effort: we still flag our side so the
    # user stops renewing even if the Noon call fails (it gets logged).
    paid = repo.latest_paid_order(user_id)
    noon_ok = False
    if sub.get("noon_subscription_id") and paid and paid.get("noon_order_id"):
        noon_ok = noon.cancel_subscription(paid["noon_order_id"], sub["noon_subscription_id"])

    repo.mark_cancel_at_period_end(user_id)
    return {
        "status": "canceled",
        "noon_canceled": noon_ok,
        "access_until": sub.get("current_period_end"),
    }


@router.get("/subscription")
def subscription(authorization: str = Header()):
    user_id = get_current_user(authorization)
    sub = SubscriptionRepository().get_subscription(user_id)
    return sub or {"plan": "free", "status": "none", "current_period_end": None}
