"""Transactions: manual create, list/search/filter, detail, edit, delete (SRS 3.1.1).

Every write recalculates the affected budgets in the same database transaction (AGENTS.md
§4.4). Every query filters by the caller's user_id; RLS applies as well. Another user's
transaction is reported as "not found".
"""

import base64
import binascii
from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import Select, case, exists, func, or_, select, tuple_
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.core.errors import ApiError, invalid_field, not_found
from app.modules.expenses import budget_service, periods
from app.modules.expenses.models import Category, Transaction, TransactionLineItem
from app.modules.expenses.schemas import (
    CategoryRef,
    CategoryTotal,
    LineItem,
    TransactionCreate,
    TransactionDetail,
    TransactionPage,
    TransactionSaved,
    TransactionSummary,
    TransactionUpdate,
)
from app.modules.expenses.schemas import Transaction as TransactionOut

DEFAULT_PAGE_SIZE = 30
MAX_PAGE_SIZE = 100


# ---------- filters ----------


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _filtered(
    stmt: Select,
    user: CurrentUser,
    *,
    date_from: date | None,
    date_to: date | None,
    category_id: UUID | None,
    q: str | None,
) -> Select:
    stmt = stmt.where(Transaction.user_id == user.id)
    if date_from is not None:
        stmt = stmt.where(Transaction.occurred_at >= periods.day_bounds(date_from, date_from)[0])
    if date_to is not None:
        stmt = stmt.where(Transaction.occurred_at < periods.day_bounds(date_to, date_to)[1])
    if category_id is not None:
        stmt = stmt.where(Transaction.category_id == category_id)
    if q:
        pattern = f"%{_escape_like(q)}%"
        stmt = stmt.where(
            or_(
                Transaction.merchant.ilike(pattern, escape="\\"),
                Transaction.note.ilike(pattern, escape="\\"),
                exists().where(
                    TransactionLineItem.transaction_id == Transaction.id,
                    TransactionLineItem.name.ilike(pattern, escape="\\"),
                ),
            )
        )
    return stmt


def _check_dates(date_from: date | None, date_to: date | None) -> None:
    if date_from and date_to and date_to < date_from:
        raise invalid_field("to", "End date must be on or after the start date.", "order")


# ---------- cursor ----------


def _encode_cursor(row: Transaction) -> str:
    raw = f"{row.occurred_at.astimezone(UTC).isoformat()}|{row.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        moment, ident = base64.urlsafe_b64decode(padded).decode().split("|")
        parsed = datetime.fromisoformat(moment)
        if parsed.tzinfo is None:
            raise ValueError
        return parsed, UUID(ident)
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise invalid_field("cursor", "Invalid cursor.", "invalid_cursor") from exc


# ---------- reading ----------


def _item_counts(db: Session, ids: list[UUID]) -> dict[UUID, int]:
    if not ids:
        return {}
    rows = db.execute(
        select(TransactionLineItem.transaction_id, func.count())
        .where(TransactionLineItem.transaction_id.in_(ids))
        .group_by(TransactionLineItem.transaction_id)
    )
    return {tid: count for tid, count in rows}


def _to_out(row: Transaction, category: Category, item_count: int) -> TransactionOut:
    return TransactionOut(
        id=row.id,
        amount=row.amount,
        occurred_at=row.occurred_at,
        merchant=row.merchant,
        note=row.note,
        source=row.source,  # type: ignore[arg-type]
        receipt_id=row.receipt_id,
        category=CategoryRef.model_validate(category),
        item_count=item_count,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_transactions(
    db: Session,
    user: CurrentUser,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    category_id: UUID | None = None,
    q: str | None = None,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> TransactionPage:
    """Newest first. Keyset pagination on (occurred_at, id) so pages stay stable while
    new transactions are added."""
    _check_dates(date_from, date_to)
    stmt = _filtered(
        select(Transaction, Category).join(Category, Category.id == Transaction.category_id),
        user,
        date_from=date_from,
        date_to=date_to,
        category_id=category_id,
        q=q,
    )
    if cursor:
        moment, ident = _decode_cursor(cursor)
        stmt = stmt.where(tuple_(Transaction.occurred_at, Transaction.id) < tuple_(moment, ident))
    stmt = stmt.order_by(Transaction.occurred_at.desc(), Transaction.id.desc()).limit(limit + 1)
    rows = [(t, c) for t, c in db.execute(stmt)]
    has_more = len(rows) > limit
    rows = rows[:limit]
    counts = _item_counts(db, [t.id for t, _ in rows])
    return TransactionPage(
        items=[_to_out(t, c, counts.get(t.id, 0)) for t, c in rows],
        next_cursor=_encode_cursor(rows[-1][0]) if has_more and rows else None,
    )


def summarize(
    db: Session,
    user: CurrentUser,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    category_id: UUID | None = None,
    q: str | None = None,
) -> TransactionSummary:
    """Totals by SQL aggregation over every transaction matching the filters."""
    _check_dates(date_from, date_to)
    filters = {
        "date_from": date_from,
        "date_to": date_to,
        "category_id": category_id,
        "q": q,
    }
    totals = db.execute(
        _filtered(
            select(
                func.coalesce(func.sum(Transaction.amount), 0),
                func.count(),
                func.count(case((Transaction.source == "receipt", 1))),
            ),
            user,
            **filters,
        )
    ).one()
    by_category = db.execute(
        _filtered(
            select(Category, func.sum(Transaction.amount), func.count())
            .join(Category, Category.id == Transaction.category_id)
            .group_by(Category.id),
            user,
            **filters,
        ).order_by(func.sum(Transaction.amount).desc(), Category.sort_order, Category.name)
    ).all()
    total, count, receipt_count = periods.money(totals[0]), int(totals[1]), int(totals[2])
    return TransactionSummary(
        total=total,
        count=count,
        receipt_count=receipt_count,
        manual_count=count - receipt_count,
        by_category=[
            CategoryTotal(
                category=CategoryRef.model_validate(c),
                total=periods.money(s),
                count=n,
                share_pct=periods.percent_used(periods.money(s), total) if total > 0 else 0,
            )
            for c, s, n in by_category
        ],
    )


def _get_own(db: Session, user: CurrentUser, transaction_id: UUID) -> Transaction:
    row = db.scalar(
        select(Transaction).where(Transaction.id == transaction_id, Transaction.user_id == user.id)
    )
    if row is None:
        raise not_found("Transaction")
    return row


def _category(db: Session, row: Transaction) -> Category:
    category = db.get(Category, row.category_id)
    assert category is not None  # foreign key + RLS: the row's own or a default category
    return category


def get_transaction(db: Session, user: CurrentUser, transaction_id: UUID) -> TransactionDetail:
    row = _get_own(db, user, transaction_id)
    items = list(
        db.scalars(
            select(TransactionLineItem)
            .where(TransactionLineItem.transaction_id == row.id)
            .order_by(TransactionLineItem.created_at, TransactionLineItem.id)
        )
    )
    base = _to_out(row, _category(db, row), len(items))
    return TransactionDetail(
        **base.model_dump(),
        items=[LineItem.model_validate(i) for i in items],
        budgets=budget_service.impacts_for(db, user, row),
    )


# ---------- writing ----------


def _require_category(db: Session, user: CurrentUser, category_id: UUID) -> Category:
    category = budget_service.visible_category(db, user, category_id)
    if category is None:
        raise invalid_field("category_id", "Choose one of your categories.", "unknown_category")
    return category


def create_transaction(db: Session, user: CurrentUser, data: TransactionCreate) -> TransactionSaved:
    category = _require_category(db, user, data.category_id)
    row = Transaction(
        user_id=user.id,
        category_id=category.id,
        amount=data.amount,
        occurred_at=data.occurred_at,
        merchant=data.merchant,
        note=data.note,
        source="manual",
    )
    db.add(row)
    db.flush()
    alerts = budget_service.recalculate(db, user, {category.id})
    db.refresh(row)
    return TransactionSaved(**_to_out(row, category, 0).model_dump(), budget_alerts=alerts)


def update_transaction(
    db: Session, user: CurrentUser, transaction_id: UUID, data: TransactionUpdate
) -> TransactionSaved:
    row = _get_own(db, user, transaction_id)
    fields = data.model_fields_set
    touched = {row.category_id}
    if "category_id" in fields and data.category_id is not None:
        row.category_id = _require_category(db, user, data.category_id).id
        touched.add(row.category_id)
    if data.amount is not None:
        if row.source == "receipt" and _has_items(db, row.id) and data.amount != row.amount:
            raise ApiError(
                409,
                "amount-from-items",
                "This total comes from the receipt's items. Edit the items instead.",
            )
        row.amount = data.amount
    if data.occurred_at is not None:
        row.occurred_at = data.occurred_at
    if "merchant" in fields:
        row.merchant = data.merchant
    if "note" in fields:
        row.note = data.note
    db.flush()
    alerts = budget_service.recalculate(db, user, touched)
    db.refresh(row)
    count = _item_counts(db, [row.id]).get(row.id, 0)
    return TransactionSaved(
        **_to_out(row, _category(db, row), count).model_dump(), budget_alerts=alerts
    )


def _has_items(db: Session, transaction_id: UUID) -> bool:
    return bool(
        db.scalar(select(exists().where(TransactionLineItem.transaction_id == transaction_id)))
    )


def delete_transaction(db: Session, user: CurrentUser, transaction_id: UUID) -> None:
    row = _get_own(db, user, transaction_id)
    category_id = row.category_id
    db.delete(row)  # line items cascade
    db.flush()
    budget_service.recalculate(db, user, {category_id})
