"""Budget periods, thresholds and pace (AGENTS.md §7.2). Pure unit tests."""

from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from app.modules.expenses import periods


@dataclass
class B:
    period_type: str
    start_date: date
    end_date: date | None = None


D = Decimal


@pytest.mark.parametrize(
    ("budget", "on", "expected"),
    [
        (B("daily", date(2026, 10, 1)), date(2026, 10, 21), (date(2026, 10, 21),) * 2),
        # Weeks run Monday–Sunday (Oct 19 2026 is a Monday).
        (
            B("weekly", date(2026, 1, 1)),
            date(2026, 10, 21),
            (date(2026, 10, 19), date(2026, 10, 25)),
        ),
        (
            B("weekly", date(2026, 1, 1)),
            date(2026, 10, 25),
            (date(2026, 10, 19), date(2026, 10, 25)),
        ),
        (
            B("monthly", date(2026, 1, 1)),
            date(2026, 10, 21),
            (date(2026, 10, 1), date(2026, 10, 31)),
        ),
        (B("monthly", date(2026, 1, 1)), date(2028, 2, 10), (date(2028, 2, 1), date(2028, 2, 29))),
        # First period is clipped to the start date, the last to the end date.
        (
            B("monthly", date(2026, 10, 15)),
            date(2026, 10, 20),
            (date(2026, 10, 15), date(2026, 10, 31)),
        ),
        (
            B("weekly", date(2026, 1, 1), date(2026, 10, 21)),
            date(2026, 10, 20),
            (date(2026, 10, 19), date(2026, 10, 21)),
        ),
        (
            B("custom", date(2026, 10, 5), date(2026, 11, 4)),
            date(2026, 10, 20),
            (date(2026, 10, 5), date(2026, 11, 4)),
        ),
    ],
)
def test_period_containing(budget: B, on: date, expected: tuple[date, date]) -> None:
    assert periods.period_containing(budget, on) == expected


@pytest.mark.parametrize(
    "on", [date(2026, 10, 4), date(2026, 11, 5)], ids=["before start", "after end"]
)
def test_days_outside_the_budget_have_no_period(on: date) -> None:
    assert periods.period_containing(B("custom", date(2026, 10, 5), date(2026, 11, 4)), on) is None


def test_state_and_display_period() -> None:
    budget = B("monthly", date(2026, 10, 15), date(2026, 12, 10))
    assert periods.state_on(budget, date(2026, 10, 1)) == "upcoming"
    assert periods.display_period(budget, date(2026, 10, 1)) == (
        date(2026, 10, 15),
        date(2026, 10, 31),
    )
    assert periods.state_on(budget, date(2026, 11, 3)) == "active"
    assert periods.display_period(budget, date(2026, 11, 3)) == (
        date(2026, 11, 1),
        date(2026, 11, 30),
    )
    assert periods.state_on(budget, date(2027, 1, 1)) == "ended"
    assert periods.display_period(budget, date(2027, 1, 1)) == (
        date(2026, 12, 1),
        date(2026, 12, 10),
    )


@pytest.mark.parametrize(
    ("spent", "limit", "pct", "level"),
    [
        (D("0.00"), D("100.00"), 90, "none"),
        (D("89.99"), D("100.00"), 90, "none"),
        (D("90.00"), D("100.00"), 90, "near"),  # exactly the threshold
        (D("99.99"), D("100.00"), 90, "near"),
        (D("100.00"), D("100.00"), 90, "exceeded"),  # remaining = 0 counts as exceeded
        (D("100.01"), D("100.00"), 90, "exceeded"),
        (D("1930.00"), D("2000.00"), 90, "near"),  # Budget.png "Dining out" 97 %
        (D("74.99"), D("100.00"), 75, "none"),  # user-chosen threshold
        (D("75.00"), D("100.00"), 75, "near"),
    ],
)
def test_level_thresholds(spent: Decimal, limit: Decimal, pct: int, level: str) -> None:
    assert periods.level_for(spent, limit, pct) == level


def test_level_uses_exact_decimals() -> None:
    # 0.1 + 0.2 style sums must not drift: 3 × 33.33 = 99.99 < 100 → near, not exceeded.
    spent = D("33.33") + D("33.33") + D("33.33")
    assert periods.level_for(spent, D("100.00"), 90) == "near"


@pytest.mark.parametrize(
    ("spent", "limit", "percent"),
    [(D("520"), D("500"), 104), (D("146"), D("500"), 29), (D("0.005"), D("1"), 1)],
)
def test_percent_used(spent: Decimal, limit: Decimal, percent: int) -> None:
    assert periods.percent_used(spent, limit) == percent


def test_pace_while_active() -> None:
    # Home.png: 850 cap, 512.40 spent, 12 days left → 337.60 / 12 = 28.13 (rounded down).
    p = periods.pace(
        D("512.40"), D("850"), date(2026, 5, 1), date(2026, 5, 31), date(2026, 5, 20), "active"
    )
    assert p.days_left == 12
    assert p.safe_daily_amount == D("28.13")
    # Expected by day 20 of 31: 850 × 20/31 ≈ 548.39 ≥ 512.40.
    assert p.on_pace is True


def test_pace_when_over_or_not_running() -> None:
    over = periods.pace(
        D("900"), D("850"), date(2026, 5, 1), date(2026, 5, 31), date(2026, 5, 20), "active"
    )
    assert over.safe_daily_amount == D("0.00") and over.on_pace is False
    ended = periods.pace(
        D("10"), D("850"), date(2026, 5, 1), date(2026, 5, 31), date(2026, 6, 2), "ended"
    )
    assert ended.days_left == 0 and ended.safe_daily_amount is None and ended.on_pace is None


def test_day_bounds_use_manila_midnight() -> None:
    lower, upper = periods.day_bounds(date(2026, 11, 5), date(2026, 11, 5))
    assert lower.astimezone(UTC) == datetime(2026, 11, 4, 16, 0, tzinfo=UTC)
    assert upper.astimezone(UTC) == datetime(2026, 11, 5, 16, 0, tzinfo=UTC)
    # 23:30 UTC on Nov 4 is already Nov 5 in Manila.
    assert periods.local_date(datetime(2026, 11, 4, 23, 30, tzinfo=UTC)) == date(2026, 11, 5)
