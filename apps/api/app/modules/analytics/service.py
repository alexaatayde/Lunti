"""Spending analytics (AGENTS.md §7, SRS 3.1.4) and the purchase-pattern list (SRS 3.1.5).

Windows (approved 2026-11-12; local dates in Asia/Manila, the current period runs to now):
- daily:   today vs yesterday.               Trend: the last 7 days, by day.
- weekly:  Monday → today vs the same weekdays of last week.  Trend: this week, by day.
- monthly: the 1st → today vs the same days of last month (clamped to its length).
           Trend: this month by week: days 1–7, 8–14, 15–21, 22–end.
Like for like: today is not over yet, so the previous window stops at the same time of day on
its last day (`compared_until`). A half-finished today is never compared with a full day.
"""

import calendar
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.modules.analytics.models import Product, PurchasePattern
from app.modules.analytics.schemas import (
    AnalyticsSummary,
    Period,
    ProductPattern,
    ProductRef,
    TrendBucket,
)
from app.modules.expenses import periods, purchase_history, transaction_service

TIER_ORDER = {"sufficient": 0, "limited": 1, "insufficient": 2}


def windows(period: Period, today: date) -> tuple[date, date, date, list[tuple[date, date]]]:
    """(start, previous_start, previous_end, trend buckets). Pure."""
    if period == "daily":
        yesterday = today - timedelta(days=1)
        days = [today - timedelta(days=i) for i in range(6, -1, -1)]
        return today, yesterday, yesterday, [(d, d) for d in days]
    if period == "weekly":
        monday = today - timedelta(days=today.weekday())
        days = [monday + timedelta(days=i) for i in range(7)]
        return monday, monday - timedelta(days=7), today - timedelta(days=7), [(d, d) for d in days]
    first = today.replace(day=1)
    previous_first = (first - timedelta(days=1)).replace(day=1)
    previous_len = calendar.monthrange(previous_first.year, previous_first.month)[1]
    previous_end = previous_first.replace(day=min(today.day, previous_len))
    last = calendar.monthrange(today.year, today.month)[1]
    weeks = [(1, 7), (8, 14), (15, 21), (22, last)]
    buckets = [(first.replace(day=a), first.replace(day=b)) for a, b in weeks]
    return first, previous_first, previous_end, buckets


def change_pct(total: Decimal, previous: Decimal) -> int | None:
    if previous <= 0:
        return None
    return int(((total - previous) * 100 / previous).quantize(Decimal(1), ROUND_HALF_UP))


def summary(db: Session, user: CurrentUser, period: Period) -> AnalyticsSummary:
    now = periods.local_now()
    today = now.date()
    start, previous_start, previous_end, buckets = windows(period, today)
    current = transaction_service.summarize(db, user, date_from=start, date_to=today)
    compared_until = datetime.combine(previous_end, now.timetz())
    previous_total = purchase_history.total_between(
        db, user, periods.day_bounds(previous_start, previous_start)[0], compared_until
    )
    by_day = purchase_history.daily_totals(db, user, buckets[0][0], today)

    def total_between(a: date, b: date) -> Decimal:
        return periods.money(sum((v for d, v in by_day.items() if a <= d <= b), Decimal(0)))

    return AnalyticsSummary(
        period=period,
        start=start,
        end=today,
        previous_start=previous_start,
        previous_end=previous_end,
        compared_until=compared_until,
        total=current.total,
        previous_total=previous_total,
        change_amount=current.total - previous_total,
        change_pct=change_pct(current.total, previous_total),
        transaction_count=current.count,
        by_category=current.by_category,
        trend_granularity="week" if period == "monthly" else "day",
        trend=[
            TrendBucket(start=a, end=b, total=total_between(a, b), is_future=a > today)
            for a, b in buckets
        ],
    )


def list_patterns(db: Session, user: CurrentUser) -> list[ProductPattern]:
    rows = db.execute(
        select(PurchasePattern, Product)
        .join(Product, Product.id == PurchasePattern.product_id)
        .where(PurchasePattern.user_id == user.id, PurchasePattern.purchase_count > 0)
    ).all()
    spend = purchase_history.spend_by_product(db, user, {p.product_id for p, _ in rows})
    out = []
    for pattern, product in rows:
        paid = spend.get(product.id)
        out.append(
            ProductPattern(
                product=ProductRef(id=product.id, name=product.name, unit=product.default_unit),
                purchase_count=pattern.purchase_count,
                data_tier=pattern.data_tier,  # type: ignore[arg-type]
                avg_interval_days=pattern.avg_interval_days,
                interval_stddev_days=pattern.interval_stddev_days,
                confidence=pattern.confidence_score,
                last_purchased_at=pattern.last_purchased_at,
                average_spend=(paid.total / paid.purchase_days).quantize(
                    periods.CENT, ROUND_HALF_UP
                )
                if paid and paid.purchase_days
                else None,
            )
        )
    out.sort(
        key=lambda p: (
            TIER_ORDER[p.data_tier],
            -p.confidence,
            -(p.last_purchased_at.timestamp() if p.last_purchased_at else 0),
            p.product.name.lower(),
        )
    )
    return out
