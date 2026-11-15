"""Daily receipt cleanup (D5): abandoned drafts, then orphaned photos (receipts.cleanup).

Runs from the scheduler at RECEIPT_CLEANUP_HOUR:00 Asia/Manila when SCHEDULER_ENABLED, or by
hand: `python -m scripts.cleanup_receipts`. A Postgres advisory lock lets one run at a time;
each pass is idempotent, so a repeated or interrupted run is safe.

Order matters: drafts first, so a draft whose photo couldn't be deleted is picked up by the
orphan pass on a later run (its photo is older than the orphan grace by then).
"""

import logging
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.modules.receipts import cleanup
from app.modules.receipts.storage import StorageUnavailable

logger = logging.getLogger(__name__)

CLEANUP_LOCK = "lunti:job:receipt_cleanup"


def run_receipt_cleanup(
    factory: sessionmaker[Session],
    storage: cleanup.StorageFactory,
    *,
    orphan_grace: timedelta | None = None,
    draft_retention: timedelta | None = None,
) -> dict[str, int]:
    # `is None`, not `or`: timedelta(0) is falsy, and an explicit zero must not silently
    # become the 24 h / 7 day default.
    grace = (
        timedelta(hours=settings.receipt_orphan_grace_hours)
        if orphan_grace is None
        else orphan_grace
    )
    retention = (
        timedelta(days=settings.receipt_draft_retention_days)
        if draft_retention is None
        else draft_retention
    )
    if grace < timedelta(0) or retention < timedelta(0):
        # A negative window would put the cutoff in the future and reach brand-new uploads.
        raise ValueError("orphan_grace and draft_retention must not be negative")
    counts: dict[str, int] = {"skipped": 0}
    with factory() as lock_db:
        locked = lock_db.scalar(select(func.pg_try_advisory_lock(func.hashtext(CLEANUP_LOCK))))
        if not locked:
            logger.info("Receipt cleanup already running elsewhere; skipping")
            counts["skipped"] = 1
            return counts
        try:
            counts |= cleanup.delete_stale_drafts(factory, storage, retention)
            try:
                counts |= cleanup.delete_orphan_images(factory, storage, grace)
            except StorageUnavailable:
                # Listing failed (storage down): nothing was deleted; the next run retries.
                logger.warning("Receipt storage unavailable; orphan cleanup postponed")
                counts["orphan_pass_postponed"] = 1
        finally:
            lock_db.execute(select(func.pg_advisory_unlock(func.hashtext(CLEANUP_LOCK))))
    logger.info("Receipt cleanup: %s", counts)
    return counts
