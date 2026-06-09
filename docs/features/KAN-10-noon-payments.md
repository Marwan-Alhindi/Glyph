# KAN-10 — Noon Payments (paid subscriptions)

## What it does
Lets a user upgrade from `free` to a paid plan (`pro` / `max`) by paying through
**Noon Payments Hosted Checkout**. A successful payment flips `profiles.plan`,
which the existing limit gate in [usage.py](../../glyph-backend/usage.py) already
reads — so an upgrade immediately raises the user's token/chat/teammate limits.

## Why
The `free`/`pro`/`max` tiers existed (limits in `PLAN_LIMITS`) but there was no
way to actually pay for them — the old Billing modal just opened a `mailto:`.
This wires real payment collection behind those tiers.

## Approach
- **Gateway:** Noon Payments (MENA), merchant = `DEVOLOGY` (Test portal).
- **Mode:** Hosted Checkout — Noon hosts the card page, so Glyph carries **no
  PCI scope**. (Direct/own-card-form was rejected for that reason.)
- **Billing:** monthly subscription. First charge uses `paymentAction: SALE`
  with `tokenizeCc: true` so Noon vaults the card for future renewals.

## End-to-end flow
```
BillingModal (AppLayout.jsx)
  └─ POST /payments/checkout {plan}
        backend: insert payment_orders(initiated) → Noon INITIATE → save noon_order_id
        ← { checkout_url }
  └─ window.location = checkout_url        (Noon-hosted card page)

payer pays → Noon redirects to APP_URL/app/billing/return?ref=<reference>
  └─ BillingReturn.jsx → GET /payments/verify/{ref}
        backend: _apply_paid_order → GET order from Noon → if SUCCESS:
                 subscriptions.activate (upsert + profiles.plan = plan) → mark order paid
        ← { status: "paid", plan }

Noon also calls POST /payments/webhook (server-to-server) → same _apply_paid_order
```
Both `verify` and `webhook` **re-fetch the order from Noon** (never trust the
caller) and funnel through `_apply_paid_order`, which is **idempotent** on
already-paid orders — so the redirect and the webhook racing is harmless.

## Key files
**Backend**
- [settings.py](../../glyph-backend/settings.py) — `noon_*` config + `noon_api_base` (Test/Live host switch).
- [payments/plans.py](../../glyph-backend/payments/plans.py) — `PLAN_PRICES` (SAR), period helper. **Prices are edited here.**
- [payments/noon.py](../../glyph-backend/payments/noon.py) — Noon client: `Key_` auth header, `initiate_order`, `get_order`.
- [database/subscriptions.py](../../glyph-backend/database/subscriptions.py) — `payment_orders` + `subscriptions` data access; `activate()` flips `profiles.plan`.
- [api/payments.py](../../glyph-backend/api/payments.py) — routes: `checkout`, `verify/{ref}`, `webhook`, `subscription`.
- [main.py](../../glyph-backend/main.py) — registers the router.

**Frontend**
- [AppLayout.jsx](../../glyph-frontend/src/app/AppLayout.jsx) — `BillingModal.handleUpgrade` now calls `/payments/checkout` and redirects. Plan prices shown in SAR (keep in sync with `plans.py`).
- [pages/BillingReturn.jsx](../../glyph-frontend/src/app/pages/BillingReturn.jsx) — return page; calls `/payments/verify`.
- [router.jsx](../../glyph-frontend/src/router.jsx) — adds `/app/billing/return`.

## DB / migration
`0015_noon_subscriptions.sql` in the Dendron note
`projects.glyph.backend.sql_migrations.md`. Adds `payment_orders` (audit /
idempotency log) and `subscriptions` (current paid state, one row per user).
**Apply manually in the Supabase SQL editor.**

## Config (backend `.env`)
```
NOON_BUSINESS_ID=DEVOLOGY
NOON_APPLICATION=glyph-backend
NOON_API_KEY=<Application Key from the Noon portal — secret>
NOON_MODE=Test          # flip to Live after KYC approval
```
Auth header built by the backend:
`Authorization: Key_<base64("DEVOLOGY.glyph-backend:<NOON_API_KEY>")>`

## How to test (sandbox)
1. Apply migration `0015` in Supabase.
2. Paste the Noon **Application Key** into `NOON_API_KEY` in `glyph-backend/.env`; restart uvicorn.
3. Frontend: open the user menu → **Plan & Billing** → **Upgrade** on Pro/Max.
4. You're redirected to Noon's hosted page → pay with a Noon **test card**.
5. On return, the page shows "You're on pro" and `profiles.plan` is updated.
6. Configure the **webhook URL** (`{PUBLIC_BACKEND_URL}/payments/webhook`) in the
   Noon portal so server-to-server confirmation works even if the user closes
   the tab before the redirect.

## Known follow-ups (not in this change)
- **Renewals:** the card is tokenized (`noon_card_token` stored) but there's no
  scheduler yet to charge it when `current_period_end` passes. Needs a cron/job
  calling Noon with the saved token (merchant-initiated).
- **Cancel / downgrade:** `subscriptions.status` supports `canceled` but no route
  exposes it yet; the Downgrade button is inert.
- **Webhook signature:** we re-fetch from Noon instead of verifying the payload
  signature. Verifying Noon's hash would let us trust the payload directly.
