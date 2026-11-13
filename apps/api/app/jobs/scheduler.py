"""APScheduler inside the API process (AGENTS.md §7.6). Enabled with SCHEDULER_ENABLED=true.

- daily at DAILY_JOB_HOUR:00 Asia/Manila: replenishment refresh + restock/shopping reminders.
- every minute: push stored notifications that haven't been sent (budget alerts etc.).
With several API processes each would schedule the jobs; the advisory lock and SKIP LOCKED
keep the work single (see daily.py, notifications/dispatch.py).
"""

import logging

from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import settings

logger = logging.getLogger(__name__)


def _daily() -> None:
    from app.core.db import get_session_factory
    from app.jobs.daily import run_daily
    from app.modules.expenses import periods
    from app.modules.notifications.push import get_sender

    try:
        run_daily(get_session_factory(), periods.local_today(), get_sender())
    except Exception:
        logger.exception("Daily job failed")


def _dispatch() -> None:
    from app.core.db import get_session_factory
    from app.modules.notifications.dispatch import dispatch_pending
    from app.modules.notifications.push import get_sender

    try:
        dispatch_pending(get_session_factory(), get_sender())
    except Exception:
        logger.exception("Notification dispatch failed")


def start_scheduler() -> BackgroundScheduler | None:
    if not settings.scheduler_enabled:
        return None
    if not settings.database_url:
        logger.error("SCHEDULER_ENABLED but DATABASE_URL is not set: jobs not started")
        return None
    scheduler = BackgroundScheduler(timezone=settings.tz)
    common = {"coalesce": True, "max_instances": 1, "misfire_grace_time": 3600}
    scheduler.add_job(_daily, "cron", hour=settings.daily_job_hour, minute=0, id="daily", **common)
    scheduler.add_job(_dispatch, "interval", minutes=1, id="dispatch", **common)
    scheduler.start()
    logger.info("Scheduler started (daily at %02d:00 %s)", settings.daily_job_hour, settings.tz)
    return scheduler
