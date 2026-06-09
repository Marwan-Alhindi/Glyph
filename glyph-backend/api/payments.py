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
from database.subscriptions import SubscriptionRepository
from payments import noon, plans
from settings import get_settings
from api.schemas import CheckoutRequest

router = APIRouter(prefix="/payments")


def _apply_paid_order(reference: str) -> str:
    """Re-fetch the order from Noon and, if paid, activate the subscription.
    Returns the resulting order status. Idempotent."""
    repo = SubscriptionRepository()
    order = repo.get_order(reference)
    if not order:
        raise HTTPException(status_code=404, detail="Unknown order")

    if order["status"] == "paid":
        return "paid"  # already applied — nothing to do

    noon_order_id = order.get("noon_order_id")
    if not noon_order_id:
        raise HTTPException(status_code=409, detail="Order was never initiated with Noon")

    remote = noon.get_order(noon_order_id)
    if remote["status"] != "SUCCESS":
        repo.mark_order(reference, "failed")
        return "failed"

    repo.activate(
        user_id=order["user_id"],
        plan=order["plan"],
        period_end=plans.next_period_end(),
        card_token=remote.get("card_token"),
    )
    repo.mark_order(reference, "paid")
    return "paid"


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

    return_url = f"{s.app_url}/app/billing/return?ref={reference}"
    try:
        result = noon.initiate_order(
            reference=reference,
            amount=amount,
            currency=plans.CURRENCY,
            name=f"{plans.PLAN_NAMES[plan]} subscription",
            return_url=return_url,
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

    status = _apply_paid_order(reference)
    return {"status": status, "plan": order["plan"]}


@router.post("/webhook")
async def webhook(request: Request):
    """Noon server-to-server notification. We only trust it to tell us *which*
    order changed — the actual status is re-fetched from Noon in
    _apply_paid_order, so a forged call grants nothing."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    order = body.get("order") or {}
    reference = order.get("reference") or body.get("reference")
    if not reference:
        raise HTTPException(status_code=400, detail="Missing order reference")

    try:
        _apply_paid_order(reference)
    except HTTPException:
        # Unknown order on a webhook is not actionable — ack so Noon stops retrying.
        return {"received": True}
    return {"received": True}


@router.get("/subscription")
def subscription(authorization: str = Header()):
    user_id = get_current_user(authorization)
    sub = SubscriptionRepository().get_subscription(user_id)
    return sub or {"plan": "free", "status": "none", "current_period_end": None}
