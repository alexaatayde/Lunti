"""Scheduled work (AGENTS.md §7.6). Each user is processed in their own transaction, switched
to the app role with RLS like a request (scope_session_to_user), so a job can't touch
another user's rows. One user's failure is logged and doesn't stop the others.

Safe to repeat or overlap: a Postgres advisory lock lets one run at a time, suggestions are
refreshed idempotently, and every reminder has a de-duplication key.
"""

import logging
from datetime import date

from sqlalchemy import func, select, union
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth import CurrentUser
from app.core.db import scope_session_to_user
from app.modules.analytics.models import PurchasePattern
from app.modules.notifications import dispatch
from app.modules.notifications import service as notifications
from app.modules.notifications.push import PushSender
from app.modules.replenishment.models import ShoppingList

logger = logging.getLogger(__name__)

DAILY_LOCK = "lunti:job:daily"


def _users(db: Session) -> list:
    """Users who could get a reminder: anyone with a purchase pattern or a shopping list."""
    rows = db.execute(
        union(select(PurchasePattern.user_id).distinct(), select(ShoppingList.user_id).distinct())
    )
    return sorted({r[0] for r in rows}, key=str)


def run_daily(
    factory: sessionmaker[Session],
    today: date,
    sender: PushSender,
) -> dict[str, int]:
    """06:00 Asia/Manila: refresh suggestions, store restock + shopping reminders, push."""
    counts = {"users": 0, "reminders": 0, "failed_users": 0, "skipped": 0}
    with factory() as lock_db:
        got = lock_db.scalar(select(func.pg_try_advisory_lock(func.hashtext(DAILY_LOCK))))
        if not got:
            logger.info("Daily job already running elsewhere; skipping")
            counts["skipped"] = 1
            return counts
        try:
            with factory() as db:
                user_ids = _users(db)
            for user_id in user_ids:
                counts["users"] += 1
                try:
                    with factory() as db, db.begin():
                        scope_session_to_user(db, user_id)
                        user = CurrentUser(id=user_id, email=None, claims={})
                        counts["reminders"] += notifications.daily_reminders(db, user, today)
                except Exception:
                    counts["failed_users"] += 1
                    logger.exception("Daily reminders failed for one user")
        finally:
            lock_db.execute(select(func.pg_advisory_unlock(func.hashtext(DAILY_LOCK))))
            lock_db.commit()
    counts.update(
        {f"dispatch_{k}": v for k, v in dispatch.dispatch_pending(factory, sender).items()}
    )
    logger.info("Daily job done: %s", counts)
    return counts
