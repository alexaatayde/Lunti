"""Receipt photo lifecycle outside upload (D5, SRS 3.5.4, RA 10173 data minimisation).

- A deleted scanned transaction takes its receipt row with it (same database transaction);
  the photo is deleted only after that commits (`delete_after_commit`).
- `delete_stale_drafts`: receipts never confirmed (processing / draft / failed) older than
  RECEIPT_DRAFT_RETENTION_DAYS are deleted with their photos.
- `delete_orphan_images`: photos older than RECEIPT_ORPHAN_GRACE_HOURS that no receipt row
  references are deleted. This also retries any photo whose after-commit delete failed.

The database never waits on storage: rows are deleted and committed first, photos follow.
A photo that fails to delete is only ever an orphan, which the next run removes. Running
either pass again finds nothing left to do.
"""

import logging
from collections.abc import Callable
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth import CurrentUser
from app.core.db import scope_session_to_user
from app.modules.receipts.models import Receipt
from app.modules.receipts.storage import RECEIPT_PATH, ReceiptStorage

logger = logging.getLogger(__name__)

StorageFactory = Callable[[], ReceiptStorage]

UNCONFIRMED = ("processing", "draft", "failed")
_PENDING = "lunti_receipt_images_to_delete"


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


def delete_stale_drafts(
    factory: sessionmaker[Session], storage: StorageFactory, retention: timedelta
) -> dict[str, int]:
    """Unconfirmed receipts older than `retention` (server time), with their photos."""
    counts = {"stale_drafts_deleted": 0, "stale_drafts_skipped": 0}
    with factory() as db:
        candidates = db.execute(
            select(Receipt.id, Receipt.user_id).where(
                Receipt.ocr_status.in_(UNCONFIRMED),
                Receipt.created_at < func.now() - retention,
            )
        ).all()
    for receipt_id, user_id in candidates:
        with factory() as db, db.begin():
            scope_session_to_user(db, user_id)  # app role + RLS: this user's row only
            # SKIP LOCKED: a confirm holds this row; leave it. Conditions re-checked under
            # the lock, so a receipt confirmed meanwhile is never touched.
            row = db.scalar(
                select(Receipt)
                .where(
                    Receipt.id == receipt_id,
                    Receipt.user_id == user_id,
                    Receipt.ocr_status.in_(UNCONFIRMED),
                    Receipt.created_at < func.now() - retention,
                )
                .with_for_update(skip_locked=True)
            )
            if row is None:
                counts["stale_drafts_skipped"] += 1
                continue
            path = row.image_path
            db.delete(row)
            db.flush()
            delete_after_commit(db, storage, path)
        counts["stale_drafts_deleted"] += 1
    return counts


def delete_orphan_images(
    factory: sessionmaker[Session], storage: StorageFactory, grace: timedelta
) -> dict[str, int]:
    """Photos older than `grace` that no receipt row references. Only names receipts create
    ({user_id}/{receipt_id}.{ext}); anything else in the bucket is left alone."""
    counts = {"orphans_deleted": 0, "images_kept": 0, "ignored_names": 0, "orphan_failures": 0}
    with factory() as db:
        cutoff = _db_now(db) - grace
    for obj in storage().list_objects():
        if not RECEIPT_PATH.match(obj.path):
            counts["ignored_names"] += 1
            continue
        if obj.created_at >= cutoff:  # recent: an upload may still be committing
            counts["images_kept"] += 1
            continue
        with factory() as db:
            referenced = db.scalar(select(Receipt.id).where(Receipt.image_path == obj.path))
        if referenced is not None:
            counts["images_kept"] += 1
            continue
        try:
            storage().delete(obj.path)
            counts["orphans_deleted"] += 1
        except Exception:  # noqa: BLE001 - retried on the next run
            counts["orphan_failures"] += 1
            logger.warning("Orphaned receipt photo not deleted; next run retries")
    return counts


def _db_now(db: Session) -> datetime:
    """The database server's clock (the same clock that stamps created_at)."""
    return db.scalar(select(func.now()))
