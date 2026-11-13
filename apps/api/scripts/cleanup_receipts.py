"""Run the receipt cleanup once by hand (the scheduler runs it daily when enabled).

    cd apps/api && .venv/bin/python -m scripts.cleanup_receipts [--dry-run]

Uses DATABASE_URL and the configured RECEIPT_STORAGE, like the API. --dry-run lists what
would be deleted and changes nothing.
"""

import argparse
import json
import logging
from datetime import timedelta

from sqlalchemy import func, select

from app.core.config import settings
from app.core.db import get_session_factory
from app.jobs.receipt_cleanup import run_receipt_cleanup
from app.modules.receipts import cleanup
from app.modules.receipts.models import Receipt
from app.modules.receipts.storage import RECEIPT_PATH, get_storage


def dry_run() -> dict[str, int]:
    factory = get_session_factory()
    retention = timedelta(days=settings.receipt_draft_retention_days)
    grace = timedelta(hours=settings.receipt_orphan_grace_hours)
    with factory() as db:
        drafts = db.scalar(
            select(func.count())
            .select_from(Receipt)
            .where(
                Receipt.ocr_status.in_(cleanup.UNCONFIRMED),
                Receipt.created_at < func.now() - retention,
            )
        )
        cutoff = db.scalar(select(func.now())) - grace
        referenced = set(db.scalars(select(Receipt.image_path)))
    orphans = sum(
        1
        for o in get_storage().list_objects()
        if RECEIPT_PATH.match(o.path) and o.created_at < cutoff and o.path not in referenced
    )
    return {"stale_drafts": drafts or 0, "orphaned_images": orphans}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="report only; delete nothing")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    result = dry_run() if args.dry_run else run_receipt_cleanup(get_session_factory(), get_storage)
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
