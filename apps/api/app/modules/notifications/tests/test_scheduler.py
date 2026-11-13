"""Scheduler wiring and push configuration (no database, no network)."""

import pytest

from app.jobs import scheduler
from app.modules.notifications import push


def test_scheduler_is_off_unless_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(scheduler.settings, "scheduler_enabled", False)
    assert scheduler.start_scheduler() is None


def test_scheduler_needs_a_database(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(scheduler.settings, "scheduler_enabled", True)
    monkeypatch.setattr(scheduler.settings, "database_url", "")
    assert scheduler.start_scheduler() is None


def test_scheduler_runs_daily_at_six_manila_and_dispatches_every_minute(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(scheduler.settings, "scheduler_enabled", True)
    monkeypatch.setattr(scheduler.settings, "database_url", "postgresql://unused/db")
    started = scheduler.start_scheduler()
    assert started is not None
    try:
        daily = started.get_job("daily")
        assert str(daily.trigger.timezone) == "Asia/Manila"
        assert "hour='6'" in str(daily.trigger) and "minute='0'" in str(daily.trigger)
        assert started.get_job("dispatch").trigger.interval.total_seconds() == 60
    finally:
        started.shutdown(wait=False)


def test_push_is_disabled_without_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    push.get_sender.cache_clear()
    monkeypatch.setattr(push.settings, "fcm_credentials", "")
    try:
        sender = push.get_sender()
        assert sender.name == "disabled"
        assert sender.send(["t"], push.PushMessage("x", "y")).delivered == 0
        monkeypatch.setattr(push.settings, "fcm_credentials", "/nonexistent/fcm.json")
        push.get_sender.cache_clear()
        assert push.get_sender().name == "disabled"
    finally:
        push.get_sender.cache_clear()
