"""Per-user rate limits for costly or sensitive endpoints (Phase 8B).

Limits are keyed by the authenticated user id and an endpoint bucket, never by IP address, so
one user can't use up another's allowance (a shared mobile network or NAT is common in the
Philippines). Each bucket has one or more sliding windows, e.g. "10/minute,50/day".

Check-and-record is one step under a lock, so concurrent requests can't slip past a limit.
Rejected requests are not recorded: a client that waits for `Retry-After` gets through.

Store: in memory, per API process. That is exact for the single-process deployment Lunti runs
today (the scheduler also runs in that process). With several processes or hosts each keeps its
own counts, so the effective limit multiplies; a shared store (e.g. a Postgres table or Redis)
would be needed then. It is not added yet (see the Phase 8B report).
"""

import bisect
import math
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any

from fastapi import Depends

from app.core.auth import CurrentUserDep
from app.core.config import settings
from app.core.errors import PROBLEM_JSON, ApiError, Problem

UNITS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}
PRUNE_EVERY = 1000  # hits between sweeps of idle subjects


@dataclass(frozen=True)
class Rule:
    limit: int
    window_seconds: int


def parse_rules(spec: str) -> tuple[Rule, ...]:
    """ "10/minute,50/day" → (Rule(10, 60), Rule(50, 86400)). Empty → no limit."""
    rules: list[Rule] = []
    for part in spec.replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        count, _, unit = part.partition("/")
        unit = unit.strip().lower().rstrip("s")
        if unit not in UNITS or not count.strip().isdigit() or int(count) < 1:
            raise ValueError(f"Invalid rate limit {part!r}: use e.g. '10/minute,50/day'.")
        rules.append(Rule(int(count), UNITS[unit]))
    return tuple(rules)


class RateLimiter:
    """Sliding-window log per (bucket, subject). Memory per subject is bounded by the largest
    limit in its rules."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._hits: dict[tuple[str, str], list[float]] = {}
        self._horizon: dict[tuple[str, str], int] = {}
        self._calls = 0

    def hit(self, bucket: str, subject: str, rules: tuple[Rule, ...]) -> float | None:
        """Records one request and returns None, or returns the seconds to wait (not recorded)."""
        if not rules:
            return None
        key = (bucket, subject)
        horizon = max(r.window_seconds for r in rules)
        with self._lock:
            now = self._clock()
            hits = self._hits.setdefault(key, [])
            self._horizon[key] = horizon
            del hits[: bisect.bisect_right(hits, now - horizon)]
            wait = 0.0
            for rule in rules:
                start = bisect.bisect_right(hits, now - rule.window_seconds)
                if len(hits) - start >= rule.limit:
                    # The request that has to age out of the window before another fits.
                    blocking = hits[len(hits) - rule.limit]
                    wait = max(wait, blocking + rule.window_seconds - now)
            if wait > 0:
                return wait
            hits.append(now)
            self._calls += 1
            if self._calls % PRUNE_EVERY == 0:
                self._prune(now)
            return None

    def _prune(self, now: float) -> None:
        stale = [k for k, h in self._hits.items() if not h or h[-1] <= now - self._horizon[k]]
        for k in stale:
            del self._hits[k]
            del self._horizon[k]


@lru_cache
def get_rate_limiter() -> RateLimiter:
    """App-wide limiter (tests override this dependency with their own)."""
    return RateLimiter()


@lru_cache
def rules_for(spec: str) -> tuple[Rule, ...]:
    return parse_rules(spec)


def retry_after_header(wait: float) -> str:
    return str(max(1, math.ceil(wait)))


def rate_limited(bucket: str, setting: str) -> Any:
    """Route dependency: `dependencies=[rate_limited("receipts.upload", "rate_limit_...")]`.
    Runs after authentication (401 first) and before the request's database work."""

    def check(
        user: CurrentUserDep,
        limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
    ) -> None:
        if not settings.rate_limit_enabled:
            return
        wait = limiter.hit(bucket, str(user.id), rules_for(getattr(settings, setting)))
        if wait is not None:
            raise ApiError(
                429,
                "rate-limited",
                "Too many requests. Please wait a moment and try again.",
                headers={"Retry-After": retry_after_header(wait)},
            )

    return Depends(check)


RATE_LIMIT_RESPONSE: dict[int | str, dict[str, Any]] = {
    429: {
        "model": Problem,
        "content": {PROBLEM_JSON: {}},
        "description": "Too many requests; wait `Retry-After` seconds.",
        "headers": {
            "Retry-After": {"description": "Seconds to wait.", "schema": {"type": "integer"}}
        },
    }
}
