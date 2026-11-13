"""Replenishment rules (AGENTS.md §7.4, decisions of 2026-11-13): pure, no database."""

from datetime import date
from decimal import Decimal

import pytest

from app.modules.replenishment import algorithm

TODAY = date(2026, 11, 13)


@pytest.mark.parametrize(
    ("tier", "confidence", "interval", "ok"),
    [
        ("sufficient", "0.600", "7.00", True),
        ("sufficient", "1.000", "12.20", True),
        ("sufficient", "0.599", "7.00", False),  # irregular timing
        ("limited", "0.750", "7.00", False),  # approved: sufficient tier only
        ("insufficient", "0.000", None, False),
        ("sufficient", "0.900", None, False),
    ],
)
def test_eligibility(tier: str, confidence: str, interval: str | None, ok: bool) -> None:
    value = Decimal(interval) if interval else None
    assert algorithm.eligible(tier, Decimal(confidence), value) is ok


@pytest.mark.parametrize(
    ("interval", "expected"),
    [("7.00", date(2026, 11, 20)), ("12.49", date(2026, 11, 25)), ("12.50", date(2026, 11, 26))],
)
def test_predicted_date_rounds_the_interval_half_up(interval: str, expected: date) -> None:
    assert algorithm.predicted_date(TODAY, Decimal(interval)) == expected


@pytest.mark.parametrize(
    ("offset", "due"), [(-10, True), (0, True), (3, True), (4, False), (30, False)]
)
def test_due_within_the_three_day_window(offset: int, due: bool) -> None:
    assert algorithm.is_due(date.fromordinal(TODAY.toordinal() + offset), TODAY) is due


@pytest.mark.parametrize(
    ("interval", "days"), [("12.20", 6), ("7.00", 4), ("5.00", 3), ("3.00", 3), ("30.00", 15)]
)
def test_still_have_pushes_half_the_interval_but_at_least_three_days(
    interval: str, days: int
) -> None:
    pushed = algorithm.still_have_date(TODAY, Decimal(interval))
    assert (pushed - TODAY).days == days


def test_thresholds_are_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(algorithm.settings, "replenishment_min_confidence", 0.8)
    monkeypatch.setattr(algorithm.settings, "replenishment_window_days", 1)
    assert not algorithm.eligible("sufficient", Decimal("0.7"), Decimal(7))
    assert not algorithm.is_due(date(2026, 11, 15), TODAY)
