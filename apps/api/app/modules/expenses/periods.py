"""Budget periods and thresholds (AGENTS.md §7.2). Pure functions: no database, no clock.

Period rules (proposed for review — the SDD doesn't define them):
- daily: one calendar day.
- weekly: Monday–Sunday.
- monthly: one calendar month.
- custom: start_date–end_date, once.
Recurring budgets start counting on start_date and stop after end_date (if set), so the first
and last periods can be shorter than a full day/week/month. All dates are local dates in the
app time zone (Asia/Manila).
"""

import calendar
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import Literal, Protocol
from zoneinfo import ZoneInfo

from app.core.config import settings

PeriodType = Literal["daily", "weekly", "monthly", "custom"]
Level = Literal["none", "near", "exceeded"]
State = Literal["active", "upcoming", "ended"]

LEVEL_RANK: dict[str, int] = {"none": 0, "near": 1, "exceeded": 2}
CENT = Decimal("0.01")


class BudgetLike(Protocol):
    period_type: str
    start_date: date
    end_date: date | None


def money(value: Decimal | int | str) -> Decimal:
    """A database sum as a 2-decimal Decimal (SUM over no rows comes back as 0)."""
    return Decimal(value).quantize(CENT)


def app_tz() -> ZoneInfo:
    return ZoneInfo(settings.tz)


def local_now() -> datetime:
    """The current moment in the app time zone."""
    return datetime.now(app_tz())


def local_today(now: datetime | None = None) -> date:
    return (now or datetime.now(app_tz())).astimezone(app_tz()).date()


def local_date(moment: datetime) -> date:
    return moment.astimezone(app_tz()).date()


def day_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    """[start 00:00, day after end 00:00) in the app time zone, for timestamp filters."""
    tz = app_tz()
    return (
        datetime.combine(start, time.min, tzinfo=tz),
        datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz),
    )


def _calendar_period(period_type: str, on: date) -> tuple[date, date]:
    if period_type == "daily":
        return on, on
    if period_type == "weekly":
        monday = on - timedelta(days=on.weekday())
        return monday, monday + timedelta(days=6)
    if period_type == "monthly":
        last = calendar.monthrange(on.year, on.month)[1]
        return on.replace(day=1), on.replace(day=last)
    raise ValueError(f"not a recurring period: {period_type}")


def period_containing(budget: BudgetLike, on: date) -> tuple[date, date] | None:
    """The budget period that includes `on`, or None if the budget doesn't cover that day."""
    if on < budget.start_date or (budget.end_date is not None and on > budget.end_date):
        return None
    if budget.period_type == "custom":
        assert budget.end_date is not None  # enforced by a check constraint
        return budget.start_date, budget.end_date
    start, end = _calendar_period(budget.period_type, on)
    start = max(start, budget.start_date)
    if budget.end_date is not None:
        end = min(end, budget.end_date)
    return start, end


def state_on(budget: BudgetLike, today: date) -> State:
    if today < budget.start_date:
        return "upcoming"
    if budget.end_date is not None and today > budget.end_date:
        return "ended"
    return "active"


def display_period(budget: BudgetLike, today: date) -> tuple[date, date]:
    """Current period if active; the first period if upcoming; the last one if ended."""
    state = state_on(budget, today)
    on = {
        "active": today,
        "upcoming": budget.start_date,
        "ended": budget.end_date or today,
    }[state]
    period = period_containing(budget, on)
    assert period is not None
    return period


def level_for(spent: Decimal, limit: Decimal, near_pct: int) -> Level:
    """remaining ≤ 0 → exceeded; spent ≥ near_pct % of limit → near (AGENTS.md §7.2)."""
    if limit - spent <= 0:
        return "exceeded"
    if spent * 100 >= limit * near_pct:
        return "near"
    return "none"


def percent_used(spent: Decimal, limit: Decimal) -> int:
    """Whole percent for display (may exceed 100)."""
    return int((spent * 100 / limit).quantize(Decimal(1), rounding=ROUND_HALF_UP))


@dataclass(frozen=True)
class Pace:
    days_left: int
    #  What can still be spent per remaining day (rounded down to the centavo); None if
    #  the period isn't running.
    safe_daily_amount: Decimal | None
    # Spending is at or below an even spread of the limit over the period so far.
    on_pace: bool | None


def pace(spent: Decimal, limit: Decimal, start: date, end: date, today: date, state: State) -> Pace:
    if state != "active":
        return Pace(days_left=0, safe_daily_amount=None, on_pace=None)
    days_left = (end - today).days + 1
    total_days = (end - start).days + 1
    elapsed_days = (today - start).days + 1
    remaining = max(limit - spent, Decimal(0))
    safe = (remaining / days_left).quantize(CENT, rounding=ROUND_DOWN)
    on_pace = spent * total_days <= limit * elapsed_days
    return Pace(days_left=days_left, safe_daily_amount=safe, on_pace=on_pace)
