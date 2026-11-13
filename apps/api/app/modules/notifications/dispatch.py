"""Pushes stored notifications that haven't been sent (runs every minute with the scheduler).

Runs on the API's own database connection, not as a user: it reads unsent notifications of
every user and the device tokens of exactly those users (explicit user_id joins). Rows are
claimed with FOR UPDATE SKIP LOCKED, so two workers never push the same notification.
`sent_at` means "dispatched": it is set even when the user has no device or push is disabled
(the notification is still in the app). Temporary FCM failures leave it for the next run.
"""

import logging
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from app.modules.notifications.models import DeviceToken, Notification
from app.modules.notifications.push import PushMessage, PushSender, PushUnavailable

logger = logging.getLogger(__name__)

BATCH = 200
MAX_AGE = timedelta(hours=24)  # older unsent notifications are marked without a push


def dispatch_pending(factory: sessionmaker[Session], sender: PushSender) -> dict[str, int]:
    counts = {"notifications": 0, "pushed": 0, "dead_tokens": 0, "stale": 0}
    now = datetime.now(UTC)
    with factory() as db, db.begin():
        rows = list(
            db.scalars(
                select(Notification)
                .where(Notification.sent_at.is_(None))
                .order_by(Notification.created_at)
                .limit(BATCH)
                .with_for_update(skip_locked=True)
            )
        )
        if not rows:
            return counts
        tokens: dict = defaultdict(list)
        for user_id, token in db.execute(
            select(DeviceToken.user_id, DeviceToken.fcm_token).where(
                DeviceToken.user_id.in_({r.user_id for r in rows})
            )
        ):
            tokens[user_id].append(token)

        for row in rows:
            counts["notifications"] += 1
            if now - row.created_at > MAX_AGE:
                counts["stale"] += 1  # too old to be useful as a push
            elif tokens.get(row.user_id):
                message = PushMessage(
                    title=str(row.payload.get("title", "Lunti")),
                    body=str(row.payload.get("body", "")),
                    data={"notification_id": str(row.id), "deep_link": row.deep_link or ""},
                )
                try:
                    result = sender.send(tokens[row.user_id], message)
                except PushUnavailable:
                    logger.warning("Push unavailable; will retry notification later")
                    continue
                counts["pushed"] += result.delivered
                if result.dead_tokens:
                    counts["dead_tokens"] += len(result.dead_tokens)
                    db.execute(
                        delete(DeviceToken).where(
                            DeviceToken.user_id == row.user_id,
                            DeviceToken.fcm_token.in_(result.dead_tokens),
                        )
                    )
                    tokens[row.user_id] = [
                        t for t in tokens[row.user_id] if t not in result.dead_tokens
                    ]
            row.sent_at = now
    return counts
