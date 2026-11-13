"""Replenishment rules (AGENTS.md §7.4). Pure functions: no database, no clock.

Approved 2026-11-13:
- Eligible: data tier "sufficient" (5+ purchase days) AND confidence >= 0.6. Confidence is a
  heuristic consistency score, used here only as a cut-off, never as a probability.
- predicted = anchor + average interval (rounded half up to whole days). The anchor is the
  last purchase day, or the "bought elsewhere" day if that is later (restarts the cycle
  without inventing a purchase or money).
- Due when predicted − today <= the approach window (3 days); overdue counts as due.
- "I still have some": new date = today + max(3, round(average interval / 2)).
"""

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.core.config import settings


def whole_days(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def eligible(data_tier: str, confidence: Decimal, avg_interval_days: Decimal | None) -> bool:
    return (
        data_tier == "sufficient"
        and avg_interval_days is not None
        and avg_interval_days > 0
        and confidence >= Decimal(str(settings.replenishment_min_confidence))
    )


def predicted_date(anchor: date, avg_interval_days: Decimal) -> date:
    return anchor + timedelta(days=whole_days(avg_interval_days))


def is_due(predicted: date, today: date) -> bool:
    return (predicted - today).days <= settings.replenishment_window_days


def still_have_date(today: date, avg_interval_days: Decimal) -> date:
    half = whole_days(avg_interval_days / 2)
    return today + timedelta(days=max(settings.still_have_min_days, half))
