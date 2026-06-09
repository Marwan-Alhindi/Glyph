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
) -> dict:
    """Create a Noon order and return {noon_order_id, post_url, raw}.

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
    """Fetch an order. Returns {status, captured, raw} where status is the
    latest transaction status ("SUCCESS"/"FAILED"/...) and captured is the
    saved-card token if Noon vaulted one (for renewals)."""
    s = get_settings()
    with httpx.Client(timeout=30) as client:
        resp = client.get(f"{s.noon_api_base}/order/{noon_order_id}", headers=_headers())
    resp.raise_for_status()
    body = resp.json()
    result = body.get("result", {})

    txns = result.get("transactions") or []
    status = txns[0].get("status") if txns else result.get("order", {}).get("status")

    # Noon returns the vaulted card under paymentDetails when tokenizeCc was set.
    payment = result.get("paymentDetails") or {}
    card_token = payment.get("cardToken") or payment.get("token")

    return {"status": status, "card_token": card_token, "raw": body}
