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
    "pro": Decimal("1.00"),  # TEMP: SAR 1 for production test — revert to 49.00
    "max": Decimal("199.00"),
}

PLAN_NAMES: dict[str, str] = {
    "pro": "Glyph Pro",
    "max": "Glyph Max",
}

# Ordering for upgrade/downgrade decisions. You may upgrade mid-cycle (pay the
# prorated difference) but not downgrade — downgrades happen by choosing the
# lower plan at renewal.
PLAN_RANK: dict[str, int] = {"free": 0, "pro": 1, "max": 2}

# Noon rejects near-zero charges; floor a tiny proration to this.
_MIN_CHARGE = Decimal("1.00")


def is_purchasable(plan: str) -> bool:
    return plan in PLAN_PRICES


def is_upgrade(current: str, target: str) -> bool:
    return PLAN_RANK[target] > PLAN_RANK[current]


def prorated_upgrade_amount(current: str, target: str, period_end: datetime,
                            now: datetime | None = None) -> str:
    """Mid-cycle upgrade charge = (target − current) price, prorated over the
    days remaining in the period the user already paid for."""
    now = now or datetime.now(timezone.utc)
    remaining_secs = max(0.0, (period_end - now).total_seconds())
    frac = min(Decimal(1), Decimal(str(remaining_secs)) / Decimal(86400) / Decimal(PERIOD_DAYS))
    diff = PLAN_PRICES[target] - PLAN_PRICES[current]
    amount = (diff * frac).quantize(Decimal("0.01"))
    return f"{max(amount, _MIN_CHARGE):.2f}"


def price_str(plan: str) -> str:
    """Noon expects the amount as a fixed 2-decimal string, e.g. "49.00"."""
    return f"{PLAN_PRICES[plan]:.2f}"


def next_period_end(start: datetime | None = None) -> datetime:
    """End of the access period from `start` (default: now, UTC)."""
    base = start or datetime.now(timezone.utc)
    return base + timedelta(days=PERIOD_DAYS)
