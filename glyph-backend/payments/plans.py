"""Plan pricing for paid subscriptions (KAN-10).

The plan *limits* live in usage.py (PLAN_LIMITS); this module holds what each
plan *costs*. `free` has no price (you can't check out into it). Amounts are in
SAR and edited here — they are not stored in the DB.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

CURRENCY = "SAR"

# Access granted per one-time payment. The plan lapses to free after this many
# days (enforced in UsageRepository.get_plan); the user pays again to renew.
PERIOD_DAYS = 30

# Monthly price per paid plan. Adjust these freely.
PLAN_PRICES: dict[str, Decimal] = {
    "pro": Decimal("49.00"),
    "max": Decimal("199.00"),
}

PLAN_NAMES: dict[str, str] = {
    "pro": "Glyph Pro",
    "max": "Glyph Max",
}


def is_purchasable(plan: str) -> bool:
    return plan in PLAN_PRICES


def price_str(plan: str) -> str:
    """Noon expects the amount as a fixed 2-decimal string, e.g. "49.00"."""
    return f"{PLAN_PRICES[plan]:.2f}"


def next_period_end(start: datetime | None = None) -> datetime:
    """End of the access period from `start` (default: now, UTC)."""
    base = start or datetime.now(timezone.utc)
    return base + timedelta(days=PERIOD_DAYS)
