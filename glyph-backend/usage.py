"""Plan limits, rate limiting, and token usage — business logic layer.

check_and_gate() is called before /askLLM to enforce rate and budget limits.
record_tokens() is called after each agent run to persist token consumption.
"""

import time
from collections import deque
from datetime import date

from fastapi import HTTPException

from database.usage import UsageRepository

PLAN_LIMITS: dict[str, dict] = {
    "free": {"monthly_tokens": 200_000,    "requests_per_hour": 10,  "max_chats": 3,    "max_teammates": 1},
    "pro":  {"monthly_tokens": 3_000_000,  "requests_per_hour": 60,  "max_chats": None, "max_teammates": 3},
    "max":  {"monthly_tokens": 15_000_000, "requests_per_hour": 120, "max_chats": None, "max_teammates": None},
}


def get_plan_limits(user_id: str) -> dict:
    plan = UsageRepository().get_plan(user_id)
    return {**PLAN_LIMITS.get(plan, PLAN_LIMITS[_DEFAULT_PLAN]), "plan": plan}

_DEFAULT_PLAN = "free"

# In-memory per-process rate store. Under multiple workers each process has
# its own counter — acceptable for soft rate limiting at this scale.
_rate_store: dict[str, deque] = {}


def _period_start() -> str:
    today = date.today()
    return date(today.year, today.month, 1).isoformat()


def check_and_gate(user_id: str) -> None:
    """Raise 429 if the user is over their rate or monthly token limit."""
    repo = UsageRepository()
    plan = repo.get_plan(user_id)
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS[_DEFAULT_PLAN])

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

    used = repo.get_tokens_used(user_id, _period_start())
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
    if tokens <= 0:
        return
    UsageRepository().increment_tokens(user_id, _period_start(), tokens)


def get_usage_summary(user_id: str) -> dict:
    repo = UsageRepository()
    plan = repo.get_plan(user_id)
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS[_DEFAULT_PLAN])
    used = repo.get_tokens_used(user_id, _period_start())

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
