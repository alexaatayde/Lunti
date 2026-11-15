"""Receipt photo lifecycle outside upload (D5, SRS 3.5.4, RA 10173 data minimisation).

- A deleted scanned transaction takes its receipt row with it (same database transaction);
  the photo is deleted only after that commits (`delete_after_commit`).
- `delete_stale_drafts`: receipts never confirmed (processing / draft / failed) older than
  RECEIPT_DRAFT_RETENTION_DAYS are deleted with their photos.
- `delete_orphan_images`: photos older than RECEIPT_ORPHAN_GRACE_HOURS that no receipt row
  references are deleted. This also retries any photo whose after-commit delete failed.
- `delete_abandoned_processing` (Phase 8D.4a): `processing` receipts whose upload died (lease
  expired, no progress for RECEIPT_PROCESSING_ABANDON_MINUTES) are deleted with their photos.
  A receipt an upload still holds a live lease on is never touched.
- `purge_raw_text` (Phase 8D.4a): only when RECEIPT_RAW_TEXT_RETENTION_DAYS is set, the
  recognised text of receipts confirmed longer ago than that is removed (set NULL, with
  `ocr_text_purged_at`). The receipt row, photo, transaction and items are kept.
- `prune_usage_counters`: per-user daily OCR counters older than
  OCR_USAGE_USER_RETENTION_DAYS (only today's row matters for the limit). App-wide
  counters, which hold no personal data, are kept for the usage report.

The database never waits on storage: rows are deleted and committed first, photos follow.
A photo that fails to delete is only ever an orphan, which the next run removes. Running
either pass again finds nothing left to do.

Uploads and the orphan pass coordinate through a per-path advisory lock (`lock_image_path`):
an upload holds it from inserting its receipt row until its transaction ends, and the orphan
pass skips any photo whose lock it can't take, so a photo an upload is about to reference is
never deleted.
"""

import logging
from collections.abc import Callable
from datetime import date, datetime, timedelta
from uuid import UUID

from sqlalchemy import ColumnElement, and_, delete, event, func, literal, or_, select, update
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth import CurrentUser
from app.core.db import scope_session_to_user
from app.modules.receipts import quota
from app.modules.receipts.models import OcrUsageDaily, Receipt
from app.modules.receipts.storage import ReceiptStorage, is_receipt_path

logger = logging.getLogger(__name__)

StorageFactory = Callable[[], ReceiptStorage]

UNCONFIRMED = ("processing", "draft", "failed")
_PENDING = "lunti_receipt_images_to_delete"


# ---------- per-photo lock ----------


def _path_key(path: str):  # noqa: ANN202 - SQL expression
    return func.hashtextextended(literal(f"lunti:receipt-image:{path}"), 0)


def lock_image_path(db: Session, path: str) -> None:
    """Hold the photo's lock until this transaction ends (waits for a cleanup in progress)."""
    db.execute(select(func.pg_advisory_xact_lock(_path_key(path))))


def try_lock_image_path(db: Session, path: str) -> bool:
    """Take the photo's lock for this transaction, or False if an upload holds it."""
    return bool(db.scalar(select(func.pg_try_advisory_xact_lock(_path_key(path)))))


# ---------- delete after commit ----------


def delete_after_commit(db: Session, storage: StorageFactory, path: str) -> None:
    """Delete this photo once the session's transaction commits; forget it on rollback."""
    pending = db.info.get(_PENDING)
    if pending is None:
        pending = db.info[_PENDING] = []
        event.listen(db, "after_commit", _delete_pending)
        event.listen(db, "after_rollback", _forget_pending)
    pending.append((storage, path))


def _delete_pending(session: Session) -> None:
    pending = session.info.get(_PENDING) or []
    session.info[_PENDING] = []
    for storage, path in pending:
        try:
            storage().delete(path)  # an already-missing photo counts as deleted
        except Exception:  # noqa: BLE001 - never undo a committed delete over a photo
            logger.warning("Receipt photo not deleted after commit; cleanup will retry")


def _forget_pending(session: Session) -> None:
    session.info[_PENDING] = []


# ---------- scanned transaction deleted ----------


def delete_for_transaction(
    db: Session, user: CurrentUser, receipt_id: UUID, storage: StorageFactory
) -> bool:
    """Called while deleting the receipt's transaction, in the same database transaction.
    Only the caller's own receipt (RLS + user filter). Returns whether a row was deleted."""
    row = db.scalar(
        select(Receipt)
        .where(Receipt.id == receipt_id, Receipt.user_id == user.id)
        .with_for_update()
    )
    if row is None:
        return False
    path = row.image_path
    db.delete(row)
    db.flush()
    delete_after_commit(db, storage, path)
    return True


# ---------- scheduled / manual cleanup ----------


def _no_live_lease() -> ColumnElement[bool]:
    """Not held by an upload right now (its OCR result may still arrive)."""
    return or_(Receipt.ocr_lease_expires_at.is_(None), Receipt.ocr_lease_expires_at < func.now())


def stale_draft_condition(retention: timedelta) -> ColumnElement[bool]:
    return and_(
        Receipt.ocr_status.in_(UNCONFIRMED),
        Receipt.created_at < func.now() - retention,
        _no_live_lease(),
    )


def abandoned_processing_condition(abandon: timedelta) -> ColumnElement[bool]:
    return and_(
        Receipt.ocr_status == "processing",
        Receipt.updated_at < func.now() - abandon,
        _no_live_lease(),
    )


def raw_text_purge_condition(retention: timedelta) -> ColumnElement[bool]:
    return and_(
        Receipt.ocr_status == "confirmed",
        Receipt.confirmed_at < func.now() - retention,
        Receipt.ocr_raw_text.is_not(None),
    )


def _delete_receipts(
    factory: sessionmaker[Session],
    storage: StorageFactory,
    condition: ColumnElement[bool],
    name: str,
) -> dict[str, int]:
    counts = {f"{name}_deleted": 0, f"{name}_skipped": 0}
    with factory() as db:
        candidates = db.execute(select(Receipt.id, Receipt.user_id).where(condition)).all()
    for receipt_id, user_id in candidates:
        with factory() as db, db.begin():
            scope_session_to_user(db, user_id)  # app role + RLS: this user's row only
            # SKIP LOCKED: a confirm or discard holds this row; leave it. Conditions are
            # re-checked under the lock, so a receipt confirmed (or re-leased) meanwhile is
            # never touched.
            row = db.scalar(
                select(Receipt)
                .where(Receipt.id == receipt_id, Receipt.user_id == user_id, condition)
                .with_for_update(skip_locked=True)
            )
            if row is None:
                counts[f"{name}_skipped"] += 1
                continue
            path = row.image_path
            db.delete(row)
            db.flush()
            delete_after_commit(db, storage, path)
        counts[f"{name}_deleted"] += 1
    return counts


def delete_stale_drafts(
    factory: sessionmaker[Session], storage: StorageFactory, retention: timedelta
) -> dict[str, int]:
    """Unconfirmed receipts older than `retention` (server time), with their photos."""
    return _delete_receipts(factory, storage, stale_draft_condition(retention), "stale_drafts")


def delete_abandoned_processing(
    factory: sessionmaker[Session], storage: StorageFactory, abandon: timedelta
) -> dict[str, int]:
    """`processing` receipts whose upload died and that nobody retried, with their photos."""
    return _delete_receipts(
        factory, storage, abandoned_processing_condition(abandon), "abandoned_processing"
    )


def purge_raw_text(factory: sessionmaker[Session], retention: timedelta) -> dict[str, int]:
    """Removes the recognised text of receipts confirmed more than `retention` ago. The
    structured data (transaction, items, receipt status, photo) is not touched."""
    condition = raw_text_purge_condition(retention)
    with factory() as db:
        users = db.scalars(select(Receipt.user_id).where(condition).distinct()).all()
    purged = 0
    for user_id in users:
        with factory() as db, db.begin():
            scope_session_to_user(db, user_id)
            result = db.execute(
                update(Receipt)
                .where(Receipt.user_id == user_id, condition)
                .values(ocr_raw_text=None, ocr_text_purged_at=func.now())
                .execution_options(synchronize_session=False)
            )
            purged += result.rowcount or 0
    return {"raw_text_purged": purged}


def prune_usage_counters(
    factory: sessionmaker[Session], keep_days: int, *, today: date | None = None
) -> dict[str, int]:
    """Per-user OCR counters older than `keep_days` (Manila days). Runs as the table owner:
    the app role has no access to the counters."""
    cutoff = (today or quota.usage_day()) - timedelta(days=keep_days)
    with factory() as db, db.begin():
        result = db.execute(
            delete(OcrUsageDaily).where(
                OcrUsageDaily.counter == "user_scans", OcrUsageDaily.usage_date < cutoff
            )
        )
    return {"usage_counters_pruned": result.rowcount or 0}


def delete_orphan_images(
    factory: sessionmaker[Session], storage: StorageFactory, grace: timedelta
) -> dict[str, int]:
    """Photos older than `grace` that no receipt row references. Only names receipts create
    ({user_id}/{receipt_id}.{ext}); anything else in the bucket is left alone.

    The whole listing is read before anything is deleted: the storage list is paginated by
    offset, and deleting while paging would shift later photos onto pages already read."""
    counts = {
        "orphans_deleted": 0,
        "images_kept": 0,
        "images_in_use": 0,
        "ignored_names": 0,
        "orphan_failures": 0,
    }
    with factory() as db:
        cutoff = _db_now(db) - grace
    objects = list(storage().list_objects())
    for obj in objects:
        if not is_receipt_path(obj.path):
            counts["ignored_names"] += 1
            continue
        if obj.created_at >= cutoff:  # recent: an upload may still be committing
            counts["images_kept"] += 1
            continue
        with factory() as db, db.begin():
            if not try_lock_image_path(db, obj.path):  # an upload is using this path now
                counts["images_in_use"] += 1
                continue
            referenced = db.scalar(select(Receipt.id).where(Receipt.image_path == obj.path))
            if referenced is not None:
                counts["images_kept"] += 1
                continue
            try:
                storage().delete(obj.path)  # still holding the lock
                counts["orphans_deleted"] += 1
            except Exception:  # noqa: BLE001 - retried on the next run
                counts["orphan_failures"] += 1
                logger.warning("Orphaned receipt photo not deleted; next run retries")
    return counts


def _db_now(db: Session) -> datetime:
    """The database server's clock (the same clock that stamps created_at)."""
    return db.scalar(select(func.now()))
