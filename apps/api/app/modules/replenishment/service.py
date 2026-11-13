"""Replenishment suggestions (AGENTS.md §7.4, SRS 3.1.6). Rules: replenishment/algorithm.py.

A suggestion belongs to one purchase cycle (`anchor_date`). Per product there is at most one
open suggestion (pending, or "modified" by the user), and once the user answers it (added,
dismissed) the product isn't suggested again until a new cycle starts: a new purchase, or
"bought elsewhere". `refresh` is idempotent: running it twice changes nothing.

Feedback (all recorded in `feedback`):
- add_to_list      → shopping list item (source "suggested"); status added.
- still_have       → date = today + max(3, round(interval / 2)); status modified.
- bought_elsewhere → status dismissed; the cycle restarts today (no transaction is created).
- dont_remind      → status dismissed; the product is muted (no further suggestions) until
                     the user unmutes it (Undo, or Muted items). Unmuting deletes the
                     dont_remind feedback and reopens that suggestion if its cycle is current,
                     so it keeps its id and date: no duplicate suggestion or reminder.
- dismiss          → status dismissed for this cycle.
- modify           → the user's date (today or later) and/or quantity; status modified.
"""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.core.errors import ApiError, invalid_field, not_found
from app.modules.analytics import patterns, products
from app.modules.expenses import periods, purchase_history
from app.modules.replenishment import algorithm, shopping
from app.modules.replenishment.models import ReplenishmentSuggestion
from app.modules.replenishment.schemas import (
    FeedbackResult,
    MutedProduct,
    ProductRef,
    Suggestion,
    SuggestionFeedback,
)
from app.modules.users.models import Feedback

OPEN = ("pending", "modified")
ANSWERED = ("added", "dismissed")
TARGET = "replenishment_suggestion"


# ---------- helpers ----------


def _feedback_by_product(db: Session, user: CurrentUser, action: str) -> dict[UUID, datetime]:
    """Latest feedback of this kind per product (feedback points at suggestions)."""
    rows = db.execute(
        select(ReplenishmentSuggestion.product_id, func.max(Feedback.created_at))
        .join(Feedback, Feedback.target_id == ReplenishmentSuggestion.id)
        .where(
            Feedback.user_id == user.id,
            Feedback.target_type == TARGET,
            Feedback.action == action,
            ReplenishmentSuggestion.user_id == user.id,
        )
        .group_by(ReplenishmentSuggestion.product_id)
    )
    return {p: moment for p, moment in rows}


def muted_products(db: Session, user: CurrentUser) -> set[UUID]:
    return set(_feedback_by_product(db, user, "dont_remind"))


def anchor_for(info: patterns.PatternInfo, elsewhere: datetime | None) -> date | None:
    days = []
    if info.last_purchased_at is not None:
        days.append(periods.local_date(info.last_purchased_at))
    if elsewhere is not None:
        days.append(periods.local_date(elsewhere))
    return max(days) if days else None


# ---------- refresh ----------


def refresh(
    db: Session, user: CurrentUser, today: date, product_ids: set[UUID] | None = None
) -> list[ReplenishmentSuggestion]:
    """Bring suggestions in line with the current patterns. Returns newly created ones."""
    infos = patterns.pattern_infos(db, user, product_ids)
    muted = muted_products(db, user)
    elsewhere = _feedback_by_product(db, user, "bought_elsewhere")

    stmt = select(ReplenishmentSuggestion).where(ReplenishmentSuggestion.user_id == user.id)
    if product_ids is not None:
        stmt = stmt.where(ReplenishmentSuggestion.product_id.in_(product_ids or {None}))
    rows: dict[UUID, list[ReplenishmentSuggestion]] = {}
    for row in db.scalars(stmt.with_for_update()):
        rows.setdefault(row.product_id, []).append(row)

    created: list[ReplenishmentSuggestion] = []
    with_pattern = {i.product_id for i in infos}
    for product_id, product_rows in rows.items():
        if product_id not in with_pattern:  # pattern gone (all purchases deleted)
            _drop(db, [r for r in product_rows if r.status in OPEN])

    for info in infos:
        product_rows = rows.get(info.product_id, [])
        open_rows = [r for r in product_rows if r.status in OPEN]
        anchor = anchor_for(info, elsewhere.get(info.product_id))
        if (
            anchor is None
            or info.product_id in muted
            or not algorithm.eligible(info.data_tier, info.confidence, info.avg_interval_days)
        ):
            _drop(db, open_rows)
            continue
        assert info.avg_interval_days is not None
        computed = algorithm.predicted_date(anchor, info.avg_interval_days)

        stale = [r for r in open_rows if r.anchor_date != anchor]  # a new cycle started
        _drop(db, stale)
        current = [r for r in open_rows if r not in stale]
        if current:
            row = current[0]
            row.pattern_id = info.pattern_id
            row.confidence_score = info.confidence
            if row.status == "pending":
                if algorithm.is_due(computed, today):
                    row.predicted_date = computed
                else:
                    _drop(db, [row])
            continue
        if any(r.status in ANSWERED and r.anchor_date == anchor for r in product_rows):
            continue  # already answered this cycle
        if algorithm.is_due(computed, today):
            row = ReplenishmentSuggestion(
                user_id=user.id,
                product_id=info.product_id,
                pattern_id=info.pattern_id,
                predicted_date=computed,
                confidence_score=info.confidence,
                status="pending",
                anchor_date=anchor,
            )
            db.add(row)
            created.append(row)
    db.flush()
    return created


def _drop(db: Session, rows: list[ReplenishmentSuggestion]) -> None:
    if rows:
        db.execute(
            delete(ReplenishmentSuggestion).where(
                ReplenishmentSuggestion.id.in_([r.id for r in rows])
            )
        )


# ---------- reading ----------


def _to_out(
    row: ReplenishmentSuggestion,
    info: patterns.PatternInfo | None,
    ref: tuple[str, str | None] | None,
    today: date,
) -> Suggestion:
    name, unit = (info.product_name, info.product_unit) if info else (ref or ("Item", None))
    return Suggestion(
        id=row.id,
        product=ProductRef(id=row.product_id, name=name, unit=unit),
        predicted_date=row.predicted_date,
        days_until=(row.predicted_date - today).days,
        avg_interval_days=info.avg_interval_days if info else None,
        confidence=row.confidence_score,
        status=row.status,  # type: ignore[arg-type]
        quantity=row.quantity,
        last_purchased_at=info.last_purchased_at if info else None,
    )


def _outs(
    db: Session, user: CurrentUser, rows: list[ReplenishmentSuggestion], today: date
) -> list[Suggestion]:
    ids = {r.product_id for r in rows}
    infos = {i.product_id: i for i in patterns.pattern_infos(db, user, ids)}
    refs = products.refs(db, user, ids - set(infos))
    return [_to_out(r, infos.get(r.product_id), refs.get(r.product_id), today) for r in rows]


def visible(db: Session, user: CurrentUser, today: date) -> list[ReplenishmentSuggestion]:
    """Open suggestions that are due (a snoozed one reappears when its date nears)."""
    rows = db.scalars(
        select(ReplenishmentSuggestion)
        .where(
            ReplenishmentSuggestion.user_id == user.id,
            ReplenishmentSuggestion.status.in_(OPEN),
        )
        .order_by(ReplenishmentSuggestion.predicted_date, ReplenishmentSuggestion.id)
    )
    return [r for r in rows if algorithm.is_due(r.predicted_date, today)]


def list_suggestions(db: Session, user: CurrentUser) -> list[Suggestion]:
    today = periods.local_today()
    refresh(db, user, today)  # cheap and idempotent: the list is never staler than the data
    return _outs(db, user, visible(db, user, today), today)


def get_outs(db: Session, user: CurrentUser, ids: set[UUID]) -> dict[UUID, Suggestion]:
    """Suggestions by id (for notification cards)."""
    if not ids:
        return {}
    rows = list(
        db.scalars(
            select(ReplenishmentSuggestion).where(
                ReplenishmentSuggestion.user_id == user.id, ReplenishmentSuggestion.id.in_(ids)
            )
        )
    )
    return {s.id: s for s in _outs(db, user, rows, periods.local_today())}


# ---------- feedback ----------


def give_feedback(
    db: Session, user: CurrentUser, suggestion_id: UUID, body: SuggestionFeedback
) -> FeedbackResult:
    today = periods.local_today()
    row = db.scalar(
        select(ReplenishmentSuggestion)
        .where(
            ReplenishmentSuggestion.id == suggestion_id,
            ReplenishmentSuggestion.user_id == user.id,
        )
        .with_for_update()
    )
    if row is None:
        raise not_found("Suggestion")
    if row.status not in OPEN:
        raise ApiError(409, "conflict", "You already answered this suggestion.")

    infos = patterns.pattern_infos(db, user, {row.product_id})
    info = infos[0] if infos else None
    db.add(Feedback(user_id=user.id, target_type=TARGET, target_id=row.id, action=body.action))
    item = None

    if body.action == "add_to_list":
        name, unit = (
            (info.product_name, info.product_unit)
            if info
            else products.refs(db, user, {row.product_id}).get(row.product_id, ("Item", None))
        )
        price = purchase_history.last_unit_prices(db, user, {row.product_id}).get(row.product_id)
        item = shopping.add_suggested(
            db,
            user,
            name=name,
            product_id=row.product_id,
            quantity=row.quantity or Decimal(1),
            unit=unit,
            est_price=price,
        )
        row.status = "added"
    elif body.action == "still_have":
        interval = info.avg_interval_days if info and info.avg_interval_days else Decimal(0)
        row.predicted_date = algorithm.still_have_date(today, interval)
        row.status = "modified"
    elif body.action == "modify":
        if body.predicted_date is not None:
            if body.predicted_date < today:
                raise invalid_field("predicted_date", "Choose today or a later date.", "range")
            row.predicted_date = body.predicted_date
        if body.quantity is not None:
            row.quantity = body.quantity
        row.status = "modified"
    else:  # bought_elsewhere, dont_remind, dismiss
        row.status = "dismissed"
    db.flush()
    if body.action == "bought_elsewhere":
        refresh(db, user, today, {row.product_id})  # the cycle restarts from today
    db.refresh(row)
    return FeedbackResult(suggestion=_outs(db, user, [row], today)[0], shopping_item=item)


# ---------- muted products ----------


def list_muted(db: Session, user: CurrentUser) -> list[MutedProduct]:
    muted = _feedback_by_product(db, user, "dont_remind")
    refs = products.refs(db, user, set(muted))
    out = [
        MutedProduct(
            product=ProductRef(
                id=pid, name=refs.get(pid, ("Item", None))[0], unit=refs.get(pid, (None, None))[1]
            ),
            muted_at=moment,
        )
        for pid, moment in muted.items()
    ]
    return sorted(out, key=lambda m: m.product.name.lower())


def unmute(db: Session, user: CurrentUser, product_id: UUID) -> Suggestion | None:
    """Turns reminders back on for a product. Returns the reopened suggestion, if any."""
    rows = db.execute(
        select(Feedback.id, ReplenishmentSuggestion)
        .join(ReplenishmentSuggestion, ReplenishmentSuggestion.id == Feedback.target_id)
        .where(
            Feedback.user_id == user.id,
            Feedback.target_type == TARGET,
            Feedback.action == "dont_remind",
            ReplenishmentSuggestion.user_id == user.id,
            ReplenishmentSuggestion.product_id == product_id,
        )
        .with_for_update(of=ReplenishmentSuggestion)
    ).all()
    if not rows:
        raise not_found("Muted product")
    db.execute(delete(Feedback).where(Feedback.id.in_([fid for fid, _ in rows])))

    has_open = db.scalar(
        select(func.count()).where(
            ReplenishmentSuggestion.user_id == user.id,
            ReplenishmentSuggestion.product_id == product_id,
            ReplenishmentSuggestion.status.in_(OPEN),
        )
    )
    muted_row = max((s for _, s in rows), key=lambda s: (s.updated_at, s.created_at))
    if not has_open and muted_row.status == "dismissed":
        muted_row.status = "pending"  # same id and date: same reminder key, no duplicate
    db.flush()
    today = periods.local_today()
    refresh(db, user, today, {product_id})  # drops it again if its cycle or eligibility ended
    reopened = db.get(ReplenishmentSuggestion, muted_row.id)
    if reopened is None or reopened.status not in OPEN:
        return None
    db.refresh(reopened)
    return _outs(db, user, [reopened], today)[0]
