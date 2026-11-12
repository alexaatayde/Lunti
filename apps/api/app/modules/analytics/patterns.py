"""Purchase patterns (AGENTS.md §7.3, SRS 3.1.5).

`purchase_patterns` is a cache derived from confirmed purchases: `refresh` recomputes the
rows for the given products from their full history, so the result never depends on the
order of edits. It runs inside the caller's database transaction after a receipt is
confirmed and after a transaction with line items is edited or deleted.

Algorithm (approved 2026-11-12; thresholds are configurable, see settings.pattern_*):
- Purchases are counted per local day (Asia/Manila): two lines of the same product on one
  day are one purchase, so an interval is never 0 days.
- purchase_count = number of purchase days.
  < limited (3) → insufficient: no interval, confidence 0 (nothing is predicted).
  < sufficient (5) → limited.  Otherwise → sufficient.
- Intervals = days between consecutive purchase days. avg = mean; stddev = sample standard
  deviation (n − 1). Both rounded half up to 0.01 day.
- confidence = sample_factor × regularity, rounded to 0.001, in 0–1. It is a heuristic
  consistency score for the MVP, not a statistically validated probability:
    sample_factor = min(1, intervals / (sufficient − 1))   (full weight at 5 purchases)
    regularity    = max(0, 1 − stddev / avg)               (1 − coefficient of variation)
"""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.core.config import settings
from app.modules.analytics.models import Product, PurchasePattern
from app.modules.expenses import periods, purchase_history

DataTier = str  # "sufficient" | "limited" | "insufficient"
DAY = Decimal("0.01")
SCORE = Decimal("0.001")


@dataclass(frozen=True)
class PatternStats:
    purchase_count: int
    avg_interval_days: Decimal | None
    interval_stddev_days: Decimal | None
    confidence: Decimal
    data_tier: DataTier


def data_tier(purchase_count: int) -> DataTier:
    if purchase_count < settings.pattern_min_purchases_limited:
        return "insufficient"
    if purchase_count < settings.pattern_min_purchases_sufficient:
        return "limited"
    return "sufficient"


def compute(days: list[date]) -> PatternStats:
    """Pure: pattern statistics for a product bought on these local days (any order)."""
    unique = sorted(set(days))
    count = len(unique)
    tier = data_tier(count)
    if tier == "insufficient":
        return PatternStats(count, None, None, Decimal("0.000"), tier)

    intervals = [Decimal((b - a).days) for a, b in zip(unique, unique[1:], strict=False)]
    n = len(intervals)
    mean = sum(intervals, Decimal(0)) / n
    variance = sum(((i - mean) ** 2 for i in intervals), Decimal(0)) / (n - 1) if n > 1 else 0
    stddev = Decimal(variance).sqrt()

    full_weight = max(settings.pattern_min_purchases_sufficient - 1, 1)
    sample_factor = min(Decimal(1), Decimal(n) / full_weight)
    regularity = max(Decimal(0), 1 - stddev / mean)
    confidence = min(Decimal(1), sample_factor * regularity).quantize(SCORE, ROUND_HALF_UP)
    return PatternStats(
        purchase_count=count,
        avg_interval_days=mean.quantize(DAY, ROUND_HALF_UP),
        interval_stddev_days=stddev.quantize(DAY, ROUND_HALF_UP),
        confidence=confidence,
        data_tier=tier,
    )


def refresh(db: Session, user: CurrentUser, product_ids: set[UUID]) -> None:
    """Recompute the patterns of these products from their purchase history. A product with
    no purchases left loses its pattern row."""
    product_ids = {p for p in product_ids if p is not None}
    if not product_ids:
        return
    days: dict[UUID, list[date]] = {p: [] for p in product_ids}
    last: dict[UUID, datetime] = {}
    for purchase in purchase_history.purchases_of(db, user, product_ids):
        days[purchase.product_id].append(periods.local_date(purchase.occurred_at))
        last[purchase.product_id] = purchase.occurred_at  # oldest first → ends on latest

    gone = {p for p, d in days.items() if not d}
    if gone:
        db.execute(
            delete(PurchasePattern).where(
                PurchasePattern.user_id == user.id, PurchasePattern.product_id.in_(gone)
            )
        )
    rows = []
    for product_id, purchase_days in days.items():
        if not purchase_days:
            continue
        stats = compute(purchase_days)
        rows.append(
            {
                "user_id": user.id,
                "product_id": product_id,
                "purchase_count": stats.purchase_count,
                "avg_interval_days": stats.avg_interval_days,
                "interval_stddev_days": stats.interval_stddev_days,
                "confidence_score": stats.confidence,
                "data_tier": stats.data_tier,
                "last_purchased_at": last[product_id],
            }
        )
    if rows:
        stmt = pg_insert(PurchasePattern).values(rows)
        db.execute(
            stmt.on_conflict_do_update(
                index_elements=["user_id", "product_id"],
                set_={
                    col: stmt.excluded[col]
                    for col in (
                        "purchase_count",
                        "avg_interval_days",
                        "interval_stddev_days",
                        "confidence_score",
                        "data_tier",
                        "last_purchased_at",
                    )
                },
            )
        )


def refresh_all(db: Session, user: CurrentUser) -> None:
    """Recompute every product of the user (seed data, future scheduled jobs)."""
    ids = set(db.scalars(select(Product.id).where(Product.user_id == user.id)))
    refresh(db, user, ids)
