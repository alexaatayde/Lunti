"""Notification records, read state, device tokens and the reminders other modules raise
(SRS 3.7.5). Push delivery is separate (dispatch.py): a record is written in the same
database transaction as the change that caused it and pushed after commit, so a rolled-back
change never sends a push.

Rules:
- Each type respects its preference (notify_budget / notify_replenishment / notify_shopping).
- `dedupe_key` is unique per user: a reminder that a job raises twice is stored once.
- Budget alerts fire only when a budget's level rises (budget_service, AGENTS.md §7.2).
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.core.errors import not_found
from app.modules.expenses.schemas import BudgetAlert
from app.modules.notifications.models import DeviceToken, Notification
from app.modules.notifications.schemas import NotificationOut, NotificationPage
from app.modules.replenishment import algorithm, shopping
from app.modules.replenishment import service as replenishment
from app.modules.users.models import UserPreferences

PREFERENCE = {
    "budget": "notify_budget",
    "replenishment": "notify_replenishment",
    "shopping": "notify_shopping",
}
PAGE_SIZE = 50


def peso(amount: Decimal) -> str:
    return f"₱{amount:,.2f}"


def wants(db: Session, user_id: UUID, kind: str) -> bool:
    prefs = db.scalar(select(UserPreferences).where(UserPreferences.user_id == user_id))
    return True if prefs is None else bool(getattr(prefs, PREFERENCE[kind]))


def create(
    db: Session,
    user_id: UUID,
    *,
    kind: str,
    title: str,
    body: str,
    deep_link: str | None,
    payload: dict | None = None,
    dedupe_key: str | None = None,
) -> UUID | None:
    """Store a notification (unsent). None when the preference is off or it already exists."""
    if not wants(db, user_id, kind):
        return None
    stmt = (
        pg_insert(Notification)
        .values(
            user_id=user_id,
            type=kind,
            payload={"title": title, "body": body, **(payload or {})},
            deep_link=deep_link,
            dedupe_key=dedupe_key,
        )
        .on_conflict_do_nothing(index_elements=["user_id", "dedupe_key"])
        .returning(Notification.id)
    )
    return db.scalar(stmt)


# ---------- reminders raised by other modules ----------


def budget_alerts(db: Session, user: CurrentUser, alerts: list[BudgetAlert]) -> None:
    for alert in alerts:
        if alert.level == "exceeded":
            title = f"{alert.label} budget exceeded"
            body = (
                f"You've spent {peso(alert.spent)} of your {peso(alert.limit_amount)} "
                f"{alert.label} budget."
            )
        else:
            pct = int((alert.spent * 100 / alert.limit_amount).to_integral_value())
            title = f"{alert.label} budget at {pct}%"
            body = f"{peso(alert.remaining)} left in your {alert.label} budget."
        create(
            db,
            user.id,
            kind="budget",
            title=title,
            body=body,
            deep_link="/budget",
            payload={"budget_id": str(alert.budget_id), "level": alert.level},
        )


def daily_reminders(db: Session, user: CurrentUser, today: date) -> int:
    """Restock reminders for due suggestions and one shopping reminder (06:00 job).
    Idempotent: keys include the suggestion and its date, and the day."""
    created = 0
    replenishment.refresh(db, user, today)
    due = replenishment.visible(db, user, today)
    for suggestion in replenishment.get_outs(db, user, {s.id for s in due}).values():
        name = suggestion.product.name
        every = (
            f"You usually buy {name} every ~{algorithm.whole_days(suggestion.avg_interval_days)} "
            "days. Add it to your list?"
            if suggestion.avg_interval_days
            else f"Time to restock {name}? Add it to your list."
        )
        if create(
            db,
            user.id,
            kind="replenishment",
            title=f"{name} may be running low",
            body=every,
            deep_link="/meals/grocery-list",
            payload={"suggestion_id": str(suggestion.id)},
            dedupe_key=f"replenishment:{suggestion.id}:{suggestion.predicted_date}",
        ):
            created += 1
    count, estimate = shopping.open_summary(db, user)
    if count:
        items = f"{count} item{'s' if count != 1 else ''} on your list"
        body = f"{items} · est. {peso(estimate)}." if estimate > 0 else f"{items}."
        if create(
            db,
            user.id,
            kind="shopping",
            title="Shopping reminder",
            body=body,
            deep_link="/meals/grocery-list",
            dedupe_key=f"shopping:{today.isoformat()}",
        ):
            created += 1
    db.flush()
    return created


# ---------- reading ----------


def _out(row: Notification, suggestions: dict) -> NotificationOut:
    payload = row.payload or {}
    suggestion_id = payload.get("suggestion_id")
    return NotificationOut(
        id=row.id,
        type=row.type,
        title=str(payload.get("title", "")),
        body=str(payload.get("body", "")),
        deep_link=row.deep_link,
        level=payload.get("level") if row.type == "budget" else None,
        suggestion=suggestions.get(UUID(suggestion_id)) if suggestion_id else None,
        created_at=row.created_at,
        read_at=row.read_at,
    )


def list_notifications(db: Session, user: CurrentUser) -> NotificationPage:
    rows = list(
        db.scalars(
            select(Notification)
            .where(Notification.user_id == user.id)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .limit(PAGE_SIZE)
        )
    )
    ids = {UUID(r.payload["suggestion_id"]) for r in rows if r.payload.get("suggestion_id")}
    suggestions = replenishment.get_outs(db, user, ids)
    unread = db.scalar(
        select(func.count()).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    return NotificationPage(items=[_out(r, suggestions) for r in rows], unread_count=unread or 0)


def mark_read(db: Session, user: CurrentUser, notification_id: UUID) -> NotificationOut:
    row = db.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user.id
        )
    )
    if row is None:
        raise not_found("Notification")
    if row.read_at is None:
        row.read_at = datetime.now(UTC)
        db.flush()
    ids = {UUID(row.payload["suggestion_id"])} if row.payload.get("suggestion_id") else set()
    return _out(row, replenishment.get_outs(db, user, ids))


def mark_all_read(db: Session, user: CurrentUser) -> int:
    result = db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    return result.rowcount or 0


# ---------- devices ----------


def register_device(db: Session, user: CurrentUser, token: str, platform: str) -> None:
    """Upsert the caller's token. A token another account registered moves to the caller
    (the phone signed in to a different account), so pushes never reach the old account."""
    db.execute(
        text("select lunti_private.claim_device_token(:token, :platform)"),
        {"token": token, "platform": platform},
    )


def unregister_device(db: Session, user: CurrentUser, token: str) -> None:
    db.execute(
        DeviceToken.__table__.delete().where(
            DeviceToken.user_id == user.id, DeviceToken.fcm_token == token
        )
    )
