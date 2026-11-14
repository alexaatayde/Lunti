"""Isolated-test mode: test databases only, never live Supabase (Phase 8C safety review).

Why: settings are read once at import (app/core/config.py) and fall back to apps/api/.env,
which holds the LIVE database URL for local development. During Phase 8C emulator testing an
isolated server imported conftest (which imports the settings) before setting DATABASE_URL, so
the live URL won and a few read requests reached live Supabase. The same fallback also means
a local pytest run could reach live through any code path that uses the default engine.

Isolated mode is switched on with LUNTI_ISOLATED_TEST=1. The test suite (conftest.py) does it
before importing the app; emulator and integration test servers must do the same. When on:

1. DATABASE_URL must come from the process environment, never from .env (no silent fallback).
2. Before connecting, the URL must point at an approved host (unix socket, localhost,
   127.0.0.1, ::1, or LUNTI_ISOLATED_ALLOWED_HOSTS) and a database named lunti_test_*
   (server-level admin URLs used to create those databases only need the approved host).
3. After connecting, the server is asked which database it really is: current_database()
   must be lunti_test_* AND carry the marker comment that only the test harness writes
   (mark_database). A database without the marker is refused even if its name matches.
A production server with the flag set by mistake fails to start (its database is not a marked
test database); it never runs against the wrong one.

When the flag is off, none of this runs: normal development and production start as before.
"""

import os
from typing import Any

from sqlalchemy import Engine, event, make_url, text
from sqlalchemy.engine import URL

ISOLATED_ENV = "LUNTI_ISOLATED_TEST"
ALLOWED_HOSTS_ENV = "LUNTI_ISOLATED_ALLOWED_HOSTS"
DATABASE_PREFIX = "lunti_test_"
MARKER = "lunti:isolated-test-database"
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_TRUE = frozenset({"1", "true", "yes", "on"})


class IsolationError(RuntimeError):
    """An isolated test tried to use a database that is not an approved test database."""


def isolated_mode() -> bool:
    return os.environ.get(ISOLATED_ENV, "").strip().lower() in _TRUE


def _approved_hosts() -> frozenset[str]:
    extra = os.environ.get(ALLOWED_HOSTS_ENV, "")
    return _LOCAL_HOSTS | {h.strip().lower() for h in extra.split(",") if h.strip()}


def _host(url: URL) -> str | None:
    """The TCP host, or None for a unix socket (no host, or ?host=/path)."""
    host = url.host or url.query.get("host")
    if isinstance(host, tuple):  # repeated ?host= values
        host = host[0] if host else None
    if not host or str(host).startswith("/"):
        return None
    return str(host).lower()


def _describe(url: URL) -> str:
    return f"host {_host(url) or 'unix-socket'!r}, database {url.database!r}"


def check_url(url: str | URL, *, server_level: bool = False) -> None:
    """Refuse (before connecting) a URL that is not an approved test database.
    `server_level`: an admin URL used only to create/drop lunti_test_* databases."""
    parsed = make_url(url) if isinstance(url, str) else url
    host = _host(parsed)
    if host is not None and host not in _approved_hosts():
        raise IsolationError(
            f"Isolated test mode refuses {_describe(parsed)}: not an approved test host. "
            f"Use a local server, or add the host to {ALLOWED_HOSTS_ENV}."
        )
    if not server_level and not (parsed.database or "").startswith(DATABASE_PREFIX):
        raise IsolationError(
            f"Isolated test mode refuses {_describe(parsed)}: only {DATABASE_PREFIX}* "
            "databases created by the test harness may be used."
        )


def check_settings(*, database_url: str) -> None:
    """At server start in isolated mode: no .env fallback, and an approved URL."""
    explicit = os.environ.get("DATABASE_URL")
    if explicit is None:
        raise IsolationError(
            "Isolated test mode needs DATABASE_URL set in the process environment; without it "
            "the settings fall back to apps/api/.env (the live database)."
        )
    if explicit != database_url:
        raise IsolationError(
            "DATABASE_URL changed after the settings were loaded; set it before importing the "
            "app (the settings would still use the earlier value)."
        )
    if database_url:
        check_url(database_url)


def verify_identity(dbapi_connection: Any) -> str:
    """Ask the server which database this really is; refuse anything but a marked test DB."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute(
            "select current_database(), shobj_description(oid, 'pg_database')"
            " from pg_database where datname = current_database()"
        )
        name, comment = cursor.fetchone()
    finally:
        cursor.close()
    # Leave no transaction open on a fresh connection (the pool expects a clean one).
    dbapi_connection.rollback()
    if not str(name).startswith(DATABASE_PREFIX) or comment != MARKER:
        raise IsolationError(
            f"Isolated test mode refuses the connected database {name!r}: it is not a test "
            "database created and marked by the test harness."
        )
    return str(name)


def guard_engine(engine: Engine) -> Engine:
    """In isolated mode: check the URL now and the real database on every new connection."""
    if not isolated_mode():
        return engine
    check_url(engine.url)

    @event.listens_for(engine, "connect")
    def _verify(dbapi_connection: Any, _record: Any) -> None:
        verify_identity(dbapi_connection)

    return engine


def mark_database(admin_connection: Any, name: str) -> None:
    """Called by the test harness right after it creates a lunti_test_* database."""
    if not name.startswith(DATABASE_PREFIX):
        raise IsolationError(f"Only {DATABASE_PREFIX}* databases can be marked as test databases.")
    admin_connection.execute(text(f"comment on database \"{name}\" is '{MARKER}'"))
