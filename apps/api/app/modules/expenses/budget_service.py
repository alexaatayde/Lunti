"""Budgets and deterministic budget status (AGENTS.md §7.2, SDD 5.2).

All money math happens here or in SQL with Decimal / NUMERIC. Every query filters by the
caller's user_id; RLS applies as well.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.auth import CurrentUser
from app.core.errors import ApiError, invalid_field, not_found
from app.modules.expenses import periods
from app.modules.expenses.models import Budget, Category, Transaction
from app.modules.expenses.schemas import Budget as BudgetOut
from app.modules.expenses.schemas import (
    BudgetAlert,
    BudgetCreate,
    BudgetImpact,
    BudgetStatus,
    BudgetUpdate,
    CategoryRef,
)
from app.modules.users import service as users_service

OVERALL_LABEL = "Overall"


# ---------- helpers ----------


def visible_category(db: Session, user: CurrentUser, category_id: UUID) -> Category | None:
    return db.scalar(
        select(Category).where(
            Category.id == category_id,
            or_(Category.user_id.is_(None), Category.user_id == user.id),
        )
    )


def _category_names(db: Session, user: CurrentUser, ids: set[UUID]) -> dict[UUID, Category]:
    if not ids:
        return {}
    rows = db.scalars(
        select(Category).where(
            Category.id.in_(ids), or_(Category.user_id.is_(None), Category.user_id == user.id)
        )
    )
    return {c.id: c for c in rows}


def label_for(budget: Budget, categories: dict[UUID, Category]) -> str:
    if budget.category_id is None:
        return OVERALL_LABEL
    category = categories.get(budget.category_id)
    return category.name if category else "Category"


def to_out(budget: Budget, categories: dict[UUID, Category]) -> BudgetOut:
    category = categories.get(budget.category_id) if budget.category_id else None
    return BudgetOut(
        id=budget.id,
        category=CategoryRef.model_validate(category) if category else None,
        label=label_for(budget, categories),
        period_type=budget.period_type,  # type: ignore[arg-type]
        start_date=budget.start_date,
        end_date=budget.end_date,
        limit_amount=budget.limit_amount,
        alerts_enabled=budget.alerts_enabled,
        created_at=budget.created_at,
        updated_at=budget.updated_at,
    )


def spent_between(
    db: Session, user: CurrentUser, category_id: UUID | None, start: date, end: date
) -> Decimal:
    """SUM(amount) of the user's transactions on local days start..end (and category if set)."""
    lower, upper = periods.day_bounds(start, end)
    stmt = select(func.coalesce(func.sum(Transaction.amount), 0)).where(
        Transaction.user_id == user.id,
        Transaction.occurred_at >= lower,
        Transaction.occurred_at < upper,
    )
    if category_id is not None:
        stmt = stmt.where(Transaction.category_id == category_id)
    return periods.money(db.scalar(stmt))


def near_pct(db: Session, user: CurrentUser) -> int:
    """The user's "near limit" threshold (user_preferences.budget_alert_pct, default 90)."""
    return users_service.get_preferences(db, user).budget_alert_pct


@dataclass(frozen=True)
class _Computed:
    start: date
    end: date
    spent: Decimal
    remaining: Decimal
    level: periods.Level


def _compute(
    db: Session, user: CurrentUser, budget: Budget, start: date, end: date, pct: int
) -> _Computed:
    spent = spent_between(db, user, budget.category_id, start, end)
    remaining = budget.limit_amount - spent
    level = periods.level_for(spent, budget.limit_amount, pct)
    return _Computed(start=start, end=end, spent=spent, remaining=remaining, level=level)


def _get_own(db: Session, user: CurrentUser, budget_id: UUID, *, lock: bool = False) -> Budget:
    stmt = select(Budget).where(Budget.id == budget_id, Budget.user_id == user.id)
    if lock:
        stmt = stmt.with_for_update()
    budget = db.scalar(stmt)
    if budget is None:
        raise not_found("Budget")
    return budget


# ---------- alert levels ----------


def _stored_level(budget: Budget, period_start: date) -> str:
    """The saved level, or "none" if it was saved in an earlier period (a new period starts
    fresh). No extra column is needed: any change to the row bumps updated_at."""
    if budget.updated_at is not None:
        saved_on = periods.local_date(budget.updated_at)
        if saved_on < period_start:
            return "none"
    return budget.last_alert_level


def _save_level(budget: Budget, level: str) -> None:
    budget.last_alert_level = level
    # Always write, so updated_at records which period this level belongs to.
    flag_modified(budget, "last_alert_level")


def recalculate(
    db: Session, user: CurrentUser, category_ids: set[UUID], today: date | None = None
) -> list[BudgetAlert]:
    """Recompute the current-period level of every active budget that the given categories
    feed (their category budgets plus overall budgets). Run after every transaction create,
    edit and delete (AGENTS.md §4.4). Returns the budgets whose level rose — those are the
    ones to alert about; a level that falls is reset silently (§7.2)."""
    today = today or periods.local_today()
    stmt = (
        select(Budget)
        .where(
            Budget.user_id == user.id,
            Budget.start_date <= today,
            or_(Budget.end_date.is_(None), Budget.end_date >= today),
            or_(Budget.category_id.is_(None), Budget.category_id.in_(category_ids)),
        )
        .order_by(Budget.id)
        # Serialize concurrent recalculations of the same budget, so one alert isn't sent twice.
        .with_for_update()
    )
    budgets = list(db.scalars(stmt))
    if not budgets:
        return []
    pct = near_pct(db, user)
    categories = _category_names(db, user, {b.category_id for b in budgets if b.category_id})
    alerts: list[BudgetAlert] = []
    for budget in budgets:
        period = periods.period_containing(budget, today)
        assert period is not None
        computed = _compute(db, user, budget, *period, pct)
        before = _stored_level(budget, period[0])
        rose = periods.LEVEL_RANK[computed.level] > periods.LEVEL_RANK[before]
        if computed.level != budget.last_alert_level or before != budget.last_alert_level:
            _save_level(budget, computed.level)
        if rose and budget.alerts_enabled and computed.level != "none":
            alerts.append(
                BudgetAlert(
                    budget_id=budget.id,
                    label=label_for(budget, categories),
                    level=computed.level,  # type: ignore[arg-type]
                    spent=computed.spent,
                    limit_amount=budget.limit_amount,
                    remaining=computed.remaining,
                )
            )
    db.flush()
    # Push notifications for these alerts are sent by the notifications module (build step 6).
    return alerts


def _refresh_level(db: Session, user: CurrentUser, budget: Budget, today: date) -> None:
    """After a budget is created or edited, store its current level without alerting
    (the user is looking at the status right then)."""
    if periods.state_on(budget, today) != "active":
        _save_level(budget, "none")
        return
    period = periods.period_containing(budget, today)
    assert period is not None
    computed = _compute(db, user, budget, *period, near_pct(db, user))
    _save_level(budget, computed.level)


# ---------- status ----------


def _status(
    db: Session,
    user: CurrentUser,
    budget: Budget,
    categories: dict[UUID, Category],
    today: date,
    pct: int,
) -> BudgetStatus:
    state = periods.state_on(budget, today)
    start, end = periods.display_period(budget, today)
    computed = _compute(db, user, budget, start, end, pct)
    pace = periods.pace(computed.spent, budget.limit_amount, start, end, today, state)
    return BudgetStatus(
        budget=to_out(budget, categories),
        state=state,
        period_start=start,
        period_end=end,
        spent=computed.spent,
        remaining=computed.remaining,
        percent_used=periods.percent_used(computed.spent, budget.limit_amount),
        level=computed.level,
        days_left=pace.days_left,
        safe_daily_amount=pace.safe_daily_amount,
        on_pace=pace.on_pace,
    )


_STATE_ORDER = {"active": 0, "upcoming": 1, "ended": 2}


def list_status(db: Session, user: CurrentUser, today: date | None = None) -> list[BudgetStatus]:
    """Every budget with its spending for the current (or nearest) period. Order: active
    first (overall before category budgets), then upcoming, then ended."""
    today = today or periods.local_today()
    budgets = list(db.scalars(select(Budget).where(Budget.user_id == user.id)))
    categories = _category_names(db, user, {b.category_id for b in budgets if b.category_id})
    pct = near_pct(db, user) if budgets else 90
    statuses = [_status(db, user, b, categories, today, pct) for b in budgets]

    def sort_key(s: BudgetStatus):  # noqa: ANN202
        category = categories.get(s.budget.category.id) if s.budget.category else None
        return (
            _STATE_ORDER[s.state],
            s.budget.category is not None,
            category.sort_order if category else 0,
            s.budget.label.lower(),
            s.period_start,
            str(s.budget.id),
        )

    return sorted(statuses, key=sort_key)


def impacts_for(db: Session, user: CurrentUser, transaction: Transaction) -> list[BudgetImpact]:
    """Budgets the transaction counts toward, for the period that contains its date."""
    on = periods.local_date(transaction.occurred_at)
    budgets = db.scalars(
        select(Budget).where(
            Budget.user_id == user.id,
            or_(Budget.category_id.is_(None), Budget.category_id == transaction.category_id),
        )
    )
    candidates = [(b, periods.period_containing(b, on)) for b in budgets]
    covering = [(b, p) for b, p in candidates if p is not None]
    if not covering:
        return []
    categories = _category_names(db, user, {b.category_id for b, _ in covering if b.category_id})
    pct = near_pct(db, user)
    impacts = []
    for budget, (start, end) in covering:
        computed = _compute(db, user, budget, start, end, pct)
        impacts.append(
            BudgetImpact(
                budget_id=budget.id,
                label=label_for(budget, categories),
                period_type=budget.period_type,  # type: ignore[arg-type]
                period_start=start,
                period_end=end,
                limit_amount=budget.limit_amount,
                spent=computed.spent,
                remaining=computed.remaining,
                remaining_without_this=computed.remaining + transaction.amount,
                percent_used=periods.percent_used(computed.spent, budget.limit_amount),
                level=computed.level,
            )
        )
    # Category budgets first (most specific), then overall.
    impacts.sort(key=lambda i: (i.label == OVERALL_LABEL, i.label.lower(), i.period_start))
    return impacts


# ---------- CRUD ----------


def list_budgets(db: Session, user: CurrentUser) -> list[BudgetOut]:
    budgets = list(
        db.scalars(
            select(Budget)
            .where(Budget.user_id == user.id)
            .order_by(Budget.start_date.desc(), Budget.id)
        )
    )
    categories = _category_names(db, user, {b.category_id for b in budgets if b.category_id})
    return [to_out(b, categories) for b in budgets]


def _validate_shape(
    db: Session,
    user: CurrentUser,
    *,
    category_id: UUID | None,
    period_type: str,
    start_date: date,
    end_date: date | None,
    exclude: UUID | None = None,
) -> None:
    if category_id is not None and visible_category(db, user, category_id) is None:
        raise invalid_field("category_id", "Choose one of your categories.", "unknown_category")
    if period_type == "custom" and end_date is None:
        raise invalid_field("end_date", "Custom budgets need an end date.", "missing")
    if end_date is not None and end_date < start_date:
        raise invalid_field("end_date", "End date must be on or after the start date.", "order")
    # One budget per category and period type at a time, so spending isn't double-counted
    # against two identical limits.
    stmt = select(Budget).where(
        Budget.user_id == user.id,
        Budget.period_type == period_type,
        Budget.category_id.is_(None) if category_id is None else Budget.category_id == category_id,
        or_(Budget.end_date.is_(None), Budget.end_date >= start_date),
    )
    if end_date is not None:
        stmt = stmt.where(Budget.start_date <= end_date)
    if exclude is not None:
        stmt = stmt.where(Budget.id != exclude)
    if db.scalar(stmt.limit(1)) is not None:
        raise ApiError(
            409,
            "budget-exists",
            "You already have a budget like this for these dates. Edit that one instead.",
        )


def create_budget(
    db: Session, user: CurrentUser, data: BudgetCreate, today: date | None = None
) -> BudgetStatus:
    today = today or periods.local_today()
    start = data.start_date or today
    _validate_shape(
        db,
        user,
        category_id=data.category_id,
        period_type=data.period_type,
        start_date=start,
        end_date=data.end_date,
    )
    budget = Budget(
        user_id=user.id,
        category_id=data.category_id,
        period_type=data.period_type,
        start_date=start,
        end_date=data.end_date,
        limit_amount=data.limit_amount,
        alerts_enabled=data.alerts_enabled,
    )
    db.add(budget)
    db.flush()
    _refresh_level(db, user, budget, today)
    db.flush()
    db.refresh(budget)
    return get_status(db, user, budget.id, today)


def get_status(
    db: Session, user: CurrentUser, budget_id: UUID, today: date | None = None
) -> BudgetStatus:
    today = today or periods.local_today()
    budget = _get_own(db, user, budget_id)
    categories = _category_names(db, user, {budget.category_id} if budget.category_id else set())
    return _status(db, user, budget, categories, today, near_pct(db, user))


def update_budget(
    db: Session, user: CurrentUser, budget_id: UUID, data: BudgetUpdate, today: date | None = None
) -> BudgetStatus:
    today = today or periods.local_today()
    budget = _get_own(db, user, budget_id, lock=True)
    fields = data.model_fields_set
    category_id = data.category_id if "category_id" in fields else budget.category_id
    period_type = data.period_type if "period_type" in fields else budget.period_type
    start_date = data.start_date if "start_date" in fields else budget.start_date
    end_date = data.end_date if "end_date" in fields else budget.end_date
    assert period_type is not None and start_date is not None
    _validate_shape(
        db,
        user,
        category_id=category_id,
        period_type=period_type,
        start_date=start_date,
        end_date=end_date,
        exclude=budget.id,
    )
    budget.category_id = category_id
    budget.period_type = period_type
    budget.start_date = start_date
    budget.end_date = end_date
    if data.limit_amount is not None:
        budget.limit_amount = data.limit_amount
    if data.alerts_enabled is not None:
        budget.alerts_enabled = data.alerts_enabled
    db.flush()
    _refresh_level(db, user, budget, today)
    db.flush()
    db.refresh(budget)
    return get_status(db, user, budget.id, today)


def delete_budget(db: Session, user: CurrentUser, budget_id: UUID) -> None:
    db.delete(_get_own(db, user, budget_id))
    db.flush()
