"""Plan limits, budget gating, rate limiting, and token usage recording.

Called by main.py before /askLLM runs (check_and_gate) and by chat_agent.py
after each run completes (record_tokens).
"""

import time
from collections import deque
from datetime import date

from fastapi import HTTPException

from config import supabase


PLAN_LIMITS: dict[str, dict] = {
    "free": {"monthly_tokens": 200_000,    "requests_per_hour": 10},
    "pro":  {"monthly_tokens": 3_000_000,  "requests_per_hour": 60},
    "max":  {"monthly_tokens": 15_000_000, "requests_per_hour": 120},
}

_DEFAULT_PLAN = "free"

# In-memory rate store: user_id -> deque of unix timestamps (last hour only)
_rate_store: dict[str, deque] = {}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_plan(user_id: str) -> str:
    result = (
        supabase.table("profiles")
        .select("plan")
        .eq("id", user_id)
        .single()
        .execute()
    )
    return (result.data or {}).get("plan") or _DEFAULT_PLAN


def _period_start() -> date:
    today = date.today()
    return date(today.year, today.month, 1)


def _tokens_used_this_month(user_id: str) -> int:
    result = (
        supabase.table("usage_tracking")
        .select("tokens_used")
        .eq("user_id", user_id)
        .eq("period_start", _period_start().isoformat())
        .execute()
    )
    rows = result.data or []
    return rows[0]["tokens_used"] if rows else 0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def check_and_gate(user_id: str) -> None:
    """Raise 429 if the user is over their rate or monthly token limit.

    Fetches plan once and checks both limits in a single call so /askLLM
    only pays one profile lookup.
    """
    plan = _get_plan(user_id)
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS[_DEFAULT_PLAN])

    # --- Rate limit (in-memory, per hour) ---
    now = time.time()
    q = _rate_store.setdefault(user_id, deque())
    while q and q[0] < now - 3600:
        q.popleft()
    if len(q) >= limits["requests_per_hour"]:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Rate limit reached: {limits['requests_per_hour']} requests/hour "
                f"on the {plan} plan. Try again soon."
            ),
        )
    q.append(now)

    # --- Monthly budget ---
    used = _tokens_used_this_month(user_id)
    if used >= limits["monthly_tokens"]:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Monthly token limit reached on the {plan} plan "
                f"({limits['monthly_tokens']:,} tokens). "
                "Upgrade your plan or wait until next month."
            ),
        )


def record_tokens(user_id: str, tokens: int) -> None:
    """Atomically add `tokens` to the current month's usage row."""
    if tokens <= 0:
        return
    supabase.rpc(
        "increment_usage",
        {"p_user_id": user_id, "p_period": _period_start().isoformat(), "p_tokens": tokens},
    ).execute()


def get_usage_summary(user_id: str) -> dict:
    """Return plan + usage data for the current billing period."""
    plan = _get_plan(user_id)
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS[_DEFAULT_PLAN])
    used = _tokens_used_this_month(user_id)

    now = time.time()
    q = _rate_store.get(user_id, deque())
    recent_requests = sum(1 for ts in q if ts >= now - 3600)

    return {
        "plan": plan,
        "tokens_used": used,
        "tokens_limit": limits["monthly_tokens"],
        "requests_this_hour": recent_requests,
        "requests_limit": limits["requests_per_hour"],
    }
