"""Read-only purchase history from transaction line items, for other modules (AGENTS.md §3:
a module owns its tables; others call its functions). Imports nothing from other modules, so
`analytics` can use it while `transaction_service` calls `analytics` without an import cycle.
"""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.modules.expenses import periods
from app.modules.expenses.models import Transaction, TransactionLineItem


@dataclass(frozen=True)
class Purchase:
    product_id: UUID
    occurred_at: datetime


@dataclass(frozen=True)
class ProductSpend:
    total: Decimal  # sum of line totals over every purchase
    purchase_days: int  # distinct local days the product was bought


def _local_day(column):  # noqa: ANN001, ANN202 (SQL expression)
    return func.date(func.timezone(periods.app_tz().key, column))


def purchases_of(db: Session, user: CurrentUser, product_ids: set[UUID]) -> list[Purchase]:
    """Every purchase (line item) of these products, oldest first."""
    if not product_ids:
        return []
    rows = db.execute(
        select(TransactionLineItem.product_id, Transaction.occurred_at)
        .join(Transaction, Transaction.id == TransactionLineItem.transaction_id)
        .where(Transaction.user_id == user.id, TransactionLineItem.product_id.in_(product_ids))
        .order_by(Transaction.occurred_at, TransactionLineItem.id)
    )
    return [Purchase(product_id=p, occurred_at=t) for p, t in rows]


def products_in_transaction(db: Session, user: CurrentUser, transaction_id: UUID) -> set[UUID]:
    rows = db.scalars(
        select(TransactionLineItem.product_id)
        .join(Transaction, Transaction.id == TransactionLineItem.transaction_id)
        .where(
            Transaction.user_id == user.id,
            Transaction.id == transaction_id,
            TransactionLineItem.product_id.is_not(None),
        )
        .distinct()
    )
    return set(rows)


def spend_by_product(
    db: Session, user: CurrentUser, product_ids: set[UUID]
) -> dict[UUID, ProductSpend]:
    """Total paid and distinct purchase days per product (one SQL aggregation)."""
    if not product_ids:
        return {}
    rows = db.execute(
        select(
            TransactionLineItem.product_id,
            func.sum(TransactionLineItem.line_total),
            func.count(func.distinct(_local_day(Transaction.occurred_at))),
        )
        .join(Transaction, Transaction.id == TransactionLineItem.transaction_id)
        .where(Transaction.user_id == user.id, TransactionLineItem.product_id.in_(product_ids))
        .group_by(TransactionLineItem.product_id)
    )
    return {p: ProductSpend(total=periods.money(t), purchase_days=int(n)) for p, t, n in rows}


def total_between(db: Session, user: CurrentUser, lower: datetime, upper: datetime) -> Decimal:
    """Spending with lower <= occurred_at < upper (one SQL sum)."""
    total = db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.user_id == user.id,
            Transaction.occurred_at >= lower,
            Transaction.occurred_at < upper,
        )
    )
    return periods.money(total)


def daily_totals(db: Session, user: CurrentUser, start: date, end: date) -> dict[date, Decimal]:
    """Spending per local day in [start, end] (days without spending are absent)."""
    lower, upper = periods.day_bounds(start, end)
    day = _local_day(Transaction.occurred_at)
    rows = db.execute(
        select(day, func.sum(Transaction.amount))
        .where(
            Transaction.user_id == user.id,
            Transaction.occurred_at >= lower,
            Transaction.occurred_at < upper,
        )
        .group_by(day)
    )
    return {d: periods.money(total) for d, total in rows}
