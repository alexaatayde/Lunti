"""Read-only OCR usage report (Phase 8D.4a). Changes nothing.

    cd apps/api && .venv/bin/python -m scripts.ocr_usage [--days 7] [--json]

Per Manila day: billed OCR requests reserved (`used`), how they ended (`succeeded`,
`failed`, `unknown` = reserved but no outcome recorded: still running, or the process died;
counted as used because the request may have been billed), the app-wide limit, how many
users scanned and how many reached their personal limit. Aggregates only: no user ids,
receipt text, images or credentials. Runs in a READ ONLY transaction.
"""

import argparse
import json
import sys
from datetime import timedelta
from typing import Any

from sqlalchemy import text

from app.core.config import settings
from app.core.db import get_session_factory
from app.modules.receipts import quota

QUERY = text(
    """
    with days as (
      select generate_series(cast(:start as date), cast(:end as date), interval '1 day')::date
        as usage_date
    )
    select d.usage_date,
           coalesce(g.used, 0) as used,
           coalesce(g.succeeded, 0) as succeeded,
           coalesce(g.failed, 0) as failed,
           (select count(*) from public.ocr_usage_daily u
             where u.usage_date = d.usage_date and u.counter = 'user_scans') as users,
           (select count(*) from public.ocr_usage_daily u
             where u.usage_date = d.usage_date and u.counter = 'user_scans'
               and u.used >= :user_limit) as users_at_limit,
           (select coalesce(sum(u.used), 0) from public.ocr_usage_daily u
             where u.usage_date = d.usage_date and u.counter = 'user_scans') as scans
      from days d
      left join public.ocr_usage_daily g
        on g.usage_date = d.usage_date and g.counter = 'external_ocr' and g.user_id is null
     order by d.usage_date desc
    """
)


def usage(days: int) -> list[dict[str, Any]]:
    end = quota.usage_day()
    start = end - timedelta(days=days - 1)
    with get_session_factory()() as db, db.begin():
        db.execute(text("set transaction read only"))
        rows = db.execute(
            QUERY, {"start": start, "end": end, "user_limit": settings.ocr_user_daily_limit}
        ).mappings()
        return [
            {
                "date": row["usage_date"].isoformat(),
                "external_used": row["used"],
                "external_succeeded": row["succeeded"],
                "external_failed": row["failed"],
                "external_unknown": row["used"] - row["succeeded"] - row["failed"],
                "external_limit": settings.ocr_global_daily_limit,
                "scans_all_engines": int(row["scans"]),
                "users_scanning": row["users"],
                "users_at_limit": row["users_at_limit"],
            }
            for row in rows
        ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=7, help="days to show (default 7)")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)
    rows = usage(max(1, min(args.days, 366)))
    if args.json:
        print(json.dumps(rows, indent=1))
        return 0
    print(f"Billed OCR requests per day ({settings.tz}); unknown = reserved, no outcome")
    for r in rows:
        print(
            f"{r['date']}  used {r['external_used']}/{r['external_limit']}"
            f"  ok {r['external_succeeded']}  failed {r['external_failed']}"
            f"  unknown {r['external_unknown']}  scans {r['scans_all_engines']}"
            f"  users {r['users_scanning']} ({r['users_at_limit']} at limit)"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
