"""Purchase-pattern math (AGENTS.md §7.3) and analytics windows: pure functions, no database."""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.modules.analytics import patterns, service
from app.modules.analytics.products import normalize_name

D0 = date(2026, 9, 1)


def every(*gaps: int) -> list[date]:
    days = [D0]
    for gap in gaps:
        days.append(days[-1] + timedelta(days=gap))
    return days


# ---------- data tiers ----------


@pytest.mark.parametrize(
    ("count", "tier"),
    [(0, "insufficient"), (1, "insufficient"), (2, "insufficient"), (3, "limited"),
     (4, "limited"), (5, "sufficient"), (12, "sufficient")],
)  # fmt: skip
def test_data_tier_boundaries(count: int, tier: str) -> None:
    assert patterns.data_tier(count) == tier


def test_insufficient_data_predicts_nothing() -> None:
    stats = patterns.compute(every(7))  # two purchases
    assert stats.data_tier == "insufficient"
    assert stats.purchase_count == 2
    assert stats.avg_interval_days is None and stats.interval_stddev_days is None
    assert stats.confidence == Decimal("0")


def test_no_purchases() -> None:
    stats = patterns.compute([])
    assert (stats.purchase_count, stats.data_tier, stats.confidence) == (0, "insufficient", 0)


# ---------- intervals and confidence ----------


def test_perfectly_regular_sufficient_pattern_has_full_confidence() -> None:
    stats = patterns.compute(every(7, 7, 7, 7))
    assert stats.data_tier == "sufficient"
    assert stats.avg_interval_days == Decimal("7.00")
    assert stats.interval_stddev_days == Decimal("0.00")
    assert stats.confidence == Decimal("1.000")


def test_limited_pattern_is_weighted_by_sample_size() -> None:
    three = patterns.compute(every(10, 10))  # 2 intervals of the 4 needed for full weight
    four = patterns.compute(every(10, 10, 10))
    assert three.data_tier == four.data_tier == "limited"
    assert three.confidence == Decimal("0.500")
    assert four.confidence == Decimal("0.750")


def test_irregular_intervals_lower_confidence() -> None:
    # intervals 5, 9, 7, 11 → mean 8, sample stddev √(20/3) ≈ 2.582 → CV ≈ 0.3227
    stats = patterns.compute(every(5, 9, 7, 11))
    assert stats.avg_interval_days == Decimal("8.00")
    assert stats.interval_stddev_days == Decimal("2.58")
    assert stats.confidence == Decimal("0.677")


def test_very_irregular_intervals_floor_at_zero() -> None:
    stats = patterns.compute(every(1, 1, 1, 40))  # CV > 1
    assert stats.data_tier == "sufficient"
    assert stats.confidence == Decimal("0.000")


def test_same_day_purchases_count_once_and_order_does_not_matter() -> None:
    days = every(7, 7, 7, 7)
    shuffled = [days[3], days[0], days[0], days[4], days[1], days[2], days[2]]
    assert patterns.compute(shuffled) == patterns.compute(days)
    assert patterns.compute(shuffled).purchase_count == 5


def test_thresholds_are_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(patterns.settings, "pattern_min_purchases_limited", 2)
    monkeypatch.setattr(patterns.settings, "pattern_min_purchases_sufficient", 3)
    assert patterns.compute(every(7)).data_tier == "limited"
    assert patterns.compute(every(7, 7)).confidence == Decimal("1.000")


# ---------- product names ----------


@pytest.mark.parametrize(
    ("raw", "normalized"),
    [("RICE  5KG", "rice 5kg"), ("Rice 5kg", "rice 5kg"), ("Eggs (12)", "eggs 12"),
     ("  Bear-Brand_33g. ", "bear brand 33g"), ("Ｃｏｋｅ 1.5L", "coke 1 5l"), ("***", "")],
)  # fmt: skip
def test_normalize_name(raw: str, normalized: str) -> None:
    assert normalize_name(raw) == normalized


# ---------- analytics windows ----------


def test_monthly_window_compares_the_same_days_of_last_month() -> None:
    start, prev_start, prev_end, buckets = service.windows("monthly", date(2026, 10, 21))
    assert (start, prev_start, prev_end) == (date(2026, 10, 1), date(2026, 9, 1), date(2026, 9, 21))
    assert buckets == [
        (date(2026, 10, 1), date(2026, 10, 7)),
        (date(2026, 10, 8), date(2026, 10, 14)),
        (date(2026, 10, 15), date(2026, 10, 21)),
        (date(2026, 10, 22), date(2026, 10, 31)),
    ]


def test_monthly_window_clamps_to_a_shorter_previous_month() -> None:
    _, prev_start, prev_end, buckets = service.windows("monthly", date(2026, 3, 31))
    assert (prev_start, prev_end) == (date(2026, 2, 1), date(2026, 2, 28))
    _, prev_start, prev_end, _ = service.windows("monthly", date(2026, 1, 15))
    assert (prev_start, prev_end) == (date(2025, 12, 1), date(2025, 12, 15))
    assert buckets[-1] == (date(2026, 3, 22), date(2026, 3, 31))


def test_weekly_window_runs_monday_to_today() -> None:
    thursday = date(2026, 11, 12)
    start, prev_start, prev_end, buckets = service.windows("weekly", thursday)
    assert (start, prev_start, prev_end) == (
        date(2026, 11, 9),
        date(2026, 11, 2),
        date(2026, 11, 5),
    )
    assert [b[0] for b in buckets] == [date(2026, 11, 9) + timedelta(days=i) for i in range(7)]


def test_daily_window_is_today_vs_yesterday_with_a_seven_day_trend() -> None:
    today = date(2026, 11, 12)
    start, prev_start, prev_end, buckets = service.windows("daily", today)
    assert (start, prev_start, prev_end) == (today, date(2026, 11, 11), date(2026, 11, 11))
    assert buckets[0] == (date(2026, 11, 6), date(2026, 11, 6)) and buckets[-1] == (today, today)


@pytest.mark.parametrize(
    ("total", "previous", "pct"),
    [("8760.00", "9950.00", -12), ("110.00", "100.00", 10), ("100.00", "100.00", 0),
     ("50.00", "0.00", None), ("0.00", "0.00", None), ("100.50", "100.00", 1)],
)  # fmt: skip
def test_change_pct(total: str, previous: str, pct: int | None) -> None:
    assert service.change_pct(Decimal(total), Decimal(previous)) == pct
