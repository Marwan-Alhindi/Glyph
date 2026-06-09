"""Thin Noon Payments API client (KAN-10).

Hosted Checkout flow:
  1. initiate_order()  -> POST /order, returns the order id + the hosted
     `postUrl` to redirect the payer to.
  2. (payer pays on Noon's page)
  3. get_order()       -> GET /order/{id}, the source of truth for status. We
     re-fetch from Noon on both the return redirect and the webhook rather than
     trusting any payload, so a forged callback can't grant a plan.

Auth header is:  Key_<MODE> <base64("business.application:apiKey")>
e.g. "Key_Test <encoded>". The MODE word and the space are both required — Noon's
gateway returns a bare 500 if either is missing.
"""

import base64

import httpx

from settings import get_settings

# paymentAction SALE = authorize + capture in one step (right for a one-shot
# subscription charge). tokenizeCc asks Noon to vault the card and return a
# token we can charge on renewal without another redirect.
_PAYMENT_ACTION = "SALE"


def _auth_header() -> str:
    s = get_settings()
    raw = f"{s.noon_business_id}.{s.noon_application}:{s.noon_api_key}"
    token = base64.b64encode(raw.encode()).decode()
    return f"Key_{s.noon_mode} {token}"


def _headers() -> dict[str, str]:
    return {
        "Authorization": _auth_header(),
        "Content-Type": "application/json",
    }


def initiate_order(
    *,
    reference: str,
    amount: str,
    currency: str,
    name: str,
    return_url: str,
    subscription_name: str | None = None,
    payment_frequency_days: int | None = None,
) -> dict:
    """Create a Noon order and return {noon_order_id, post_url, raw}.

    When subscription_name + payment_frequency_days are given, the order is
    registered as a RECURRING subscription: Noon vaults the card and then
    auto-charges it every `payment_frequency_days` (gateway-managed — we don't
    submit the renewals, Noon does and notifies us via webhook).

    Raises httpx.HTTPStatusError on a non-2xx, or ValueError if Noon reports a
    non-zero resultCode or omits the checkout URL.
    """
    s = get_settings()
    payload = {
        "apiOperation": "INITIATE",
        "order": {
            "amount": amount,
            "currency": currency,
            "name": name,
            "reference": reference,
            "channel": "web",
            "category": "pay",
        },
        "configuration": {
            "returnUrl": return_url,
            "locale": "en",
            "paymentAction": _PAYMENT_ACTION,
            "tokenizeCc": True,
        },
    }
    if subscription_name and payment_frequency_days:
        # paymentFrequency is a day count, sent as a string (confirmed via sandbox).
        payload["subscription"] = {
            "type": "RECURRING",
            "name": subscription_name,
            "amount": amount,
            "paymentFrequency": str(payment_frequency_days),
        }

    with httpx.Client(timeout=30) as client:
        resp = client.post(f"{s.noon_api_base}/order", json=payload, headers=_headers())
    resp.raise_for_status()
    body = resp.json()

    if body.get("resultCode") not in (0, "0"):
        raise ValueError(f"Noon INITIATE failed: {body.get('message') or body}")

    result = body.get("result", {})
    order = result.get("order", {})
    checkout = result.get("checkoutData", {})
    post_url = checkout.get("postUrl")
    if not post_url:
        raise ValueError(f"Noon INITIATE returned no checkout postUrl: {body}")

    return {"noon_order_id": str(order.get("id")), "post_url": post_url, "raw": body}


def get_order(noon_order_id: str) -> dict:
    """Fetch an order. Returns {status, card_token, subscription_id, raw}:
      status          — latest transaction status ("SUCCESS"/"FAILED"/...)
      card_token      — Noon's vaulted-card token (tokenIdentifier) for renewals
      subscription_id — Noon's subscription identifier when one was registered
    """
    s = get_settings()
    with httpx.Client(timeout=30) as client:
        resp = client.get(f"{s.noon_api_base}/order/{noon_order_id}", headers=_headers())
    resp.raise_for_status()
    body = resp.json()
    result = body.get("result", {})

    order = result.get("order", {})
    txns = result.get("transactions") or []
    status = txns[0].get("status") if txns else order.get("status")

    # Vaulted card lives under paymentDetails.tokenIdentifier (confirmed via sandbox).
    payment = result.get("paymentDetails") or {}
    card_token = payment.get("tokenIdentifier")
    subscription_id = (result.get("subscription") or {}).get("identifier")

    # Decline reason for failed orders, e.g. 19047 "3DS unable to authenticate."
    error_message = order.get("errorMessage") if order.get("errorCode") else None

    return {
        "status": status,
        "card_token": card_token,
        "subscription_id": subscription_id,
        "error_message": error_message,
        "raw": body,
    }


def cancel_subscription(noon_order_id: str, subscription_id: str) -> bool:
    """Ask Noon to stop a recurring subscription's future auto-charges.

    Uses the order CANCEL operation, which accepts the subscription identifier
    and the originating order id (confirmed reachable via sandbox). Returns True
    on a zero resultCode. Best-effort: never raises, so our own cancel state can
    proceed even if Noon errors — callers should log a False return.

    NOTE: validate the exact CANCEL contract against Noon's docs before go-live.
    """
    s = get_settings()
    payload = {
        "apiOperation": "CANCEL",
        "order": {"id": noon_order_id},
        "subscription": {"identifier": subscription_id},
    }
    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(f"{s.noon_api_base}/order", json=payload, headers=_headers())
        return resp.json().get("resultCode") in (0, "0")
    except (httpx.HTTPError, ValueError):
        return False
