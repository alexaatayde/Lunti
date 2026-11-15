"""Daily OCR usage limits that survive restarts and hold across processes (Phase 8D.4a).

Two counters per day (Asia/Manila calendar day, settings.tz), kept in `ocr_usage_daily`:
- `user_scans`: OCR runs for one user (any engine, fixture included), limited by
  OCR_USER_DAILY_LIMIT (default 50);
- `external_ocr`: requests sent to a billed OCR service (Google Vision) by everyone, limited
  by OCR_GLOBAL_DAILY_LIMIT (default 50; 0 stops all external OCR). Fixture OCR never
  touches it.

How a reservation works:
- One is taken immediately before each OCR call, in its own short transaction, by
  `lunti_private.reserve_ocr_quota`. It increments both counters only if both are under
  their limits; the counter row lock makes concurrent requests queue, so a limit can't be
  overshot. A refused reservation changes nothing.
- It is never handed back once taken. Every attempt counts, including retries of the same
  receipt, failures and timeouts (a timed-out Vision request may still be billed). A retry
  can therefore never get around the limit.
- The outcome (`succeeded` / `failed`) is recorded afterwards for the metrics. A process that
  crashes after reserving leaves the reservation counted as used with no outcome: it shows up
  as `unknown` in the usage report and is never refunded, because the call may have been
  billed.
- The day is the Manila date when the reservation is taken; the outcome is recorded on the
  same day's row even if the call finishes after midnight.

The counter table is reachable only through these SECURITY DEFINER functions (no table
grants to the app role), so a request can't read or reset anyone else's usage.

A Google Cloud budget alert is a notification, not a spending cap; these limits are the hard
stop on the application side.
"""

import math
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import ApiError

Outcome = Literal["succeeded", "failed"]
Refusal = Literal["user_limit", "global_limit"]


def _tz() -> ZoneInfo:
    return ZoneInfo(settings.tz)


def now() -> datetime:
    """Current time in Asia/Manila (tests replace this to cross midnight)."""
    return datetime.now(_tz())


def usage_day(at: datetime | None = None) -> date:
    moment = at if at is not None else now()
    return moment.astimezone(_tz()).date()


def seconds_until_reset(at: datetime | None = None) -> int:
    """Seconds until the next Manila midnight, at least 1 (for Retry-After)."""
    moment = (at if at is not None else now()).astimezone(_tz())
    midnight = datetime.combine(moment.date() + timedelta(days=1), time(0), tzinfo=_tz())
    return max(1, math.ceil((midnight - moment).total_seconds()))


@dataclass(frozen=True)
class Reservation:
    day: date
    external: bool


def reserve(db: Session, *, external: bool, at: datetime | None = None) -> Reservation:
    """Take one OCR attempt from today's allowance or raise (429 user / 503 global). The
    caller commits right away and makes the OCR call only after that."""
    moment = at if at is not None else now()
    day = usage_day(moment)
    refusal = db.scalar(
        text(
            "select lunti_private.reserve_ocr_quota("
            "cast(:day as date), cast(:user_limit as integer), cast(:global_limit as integer),"
            " cast(:external as boolean))"
        ),
        {
            "day": day,
            "user_limit": settings.ocr_user_daily_limit,
            "global_limit": settings.ocr_global_daily_limit,
            "external": external,
        },
    )
    if refusal == "user_limit":
        raise ApiError(
            429,
            "ocr-daily-limit",
            f"You've reached today's limit of {settings.ocr_user_daily_limit} receipt scans."
            " You can still add this expense manually.",
            headers={"Retry-After": str(seconds_until_reset(moment))},
        )
    if refusal == "global_limit":
        raise ApiError(
            503,
            "service-unavailable",
            "Receipt scanning has reached today's limit. Please enter this receipt manually"
            " or try again tomorrow.",
            headers={"Retry-After": str(seconds_until_reset(moment))},
        )
    if refusal is not None:  # pragma: no cover - the function only returns the two above
        raise RuntimeError(f"unexpected quota result {refusal!r}")
    return Reservation(day=day, external=external)


def record_outcome(db: Session, reservation: Reservation, outcome: Outcome) -> None:
    """Metrics only (never changes what is allowed). External calls only."""
    if not reservation.external:
        return
    db.execute(
        text("select lunti_private.record_ocr_outcome(cast(:day as date), :failed)"),
        {"day": reservation.day, "failed": outcome == "failed"},
    )
