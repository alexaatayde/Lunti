"""Isolated-test mode can't silently reach live Supabase (app/core/isolation.py).

Regression for the Phase 8C emulator-validation incident: a test server imported the settings
before setting DATABASE_URL, so apps/api/.env's live URL won. The subprocess tests rebuild that
exact situation in a temporary directory with its own .env (a Supabase-looking URL that is
never contacted: the guard refuses it before any connection is made).
"""

import os
import subprocess
import sys
import textwrap
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, make_url, text

from app.core import isolation
from app.core.config import to_sqlalchemy_url
from app.core.db import make_engine
from conftest import ThrowawayDatabase, _server_url

API_DIR = Path(__file__).resolve().parents[1]
LIVE_LIKE = "postgresql://postgres:secret@db.abcdefghijklmnop.supabase.co:5432/postgres"
POOLER = "postgresql://postgres.abc:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"


# ---------- URL checks (before connecting) ----------


@pytest.mark.parametrize("url", [LIVE_LIKE, POOLER, "postgresql://u@10.0.0.5/lunti_test_x"])
def test_non_approved_hosts_are_refused(url: str) -> None:
    with pytest.raises(isolation.IsolationError, match="not an approved test host"):
        isolation.check_url(to_sqlalchemy_url(url))
    with pytest.raises(isolation.IsolationError, match="not an approved test host"):
        isolation.check_url(to_sqlalchemy_url(url), server_level=True)


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u@localhost:5432/postgres",  # the server's own database
        "postgresql://u@127.0.0.1/app",
        "postgresql://u@/lunti_prod?host=/tmp/socket",
    ],
)
def test_only_lunti_test_databases_are_allowed(url: str) -> None:
    with pytest.raises(isolation.IsolationError, match="only lunti_test_"):
        isolation.check_url(to_sqlalchemy_url(url))


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u@localhost:5432/lunti_test_abc",
        "postgresql://u@[::1]/lunti_test_abc",
        "postgresql://u:p@/lunti_test_abc?host=/Users/me/Library/Caches/pg",  # unix socket
    ],
)
def test_local_test_databases_are_allowed(url: str) -> None:
    isolation.check_url(to_sqlalchemy_url(url))


def test_server_level_admin_url_needs_only_an_approved_host() -> None:
    isolation.check_url(to_sqlalchemy_url("postgresql://u@localhost/postgres"), server_level=True)


def test_extra_hosts_can_be_approved_explicitly(monkeypatch: pytest.MonkeyPatch) -> None:
    url = to_sqlalchemy_url("postgresql://u@postgres-ci/lunti_test_abc")
    with pytest.raises(isolation.IsolationError):
        isolation.check_url(url)
    monkeypatch.setenv(isolation.ALLOWED_HOSTS_ENV, "postgres-ci")
    isolation.check_url(url)


# ---------- settings checks (no silent .env fallback) ----------


def test_missing_database_url_env_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(isolation.IsolationError, match="fall back to apps/api/.env"):
        isolation.check_settings(database_url=LIVE_LIKE)


def test_database_url_set_after_settings_loaded_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The incident's exact ordering: settings loaded first (live URL), env set afterwards."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://u@localhost/lunti_test_abc")
    with pytest.raises(isolation.IsolationError, match="changed after the settings were loaded"):
        isolation.check_settings(database_url=LIVE_LIKE)


def test_explicit_live_url_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", LIVE_LIKE)
    with pytest.raises(isolation.IsolationError, match="not an approved test host"):
        isolation.check_settings(database_url=LIVE_LIKE)


def test_the_test_suite_runs_isolated_with_no_database_url() -> None:
    """conftest switches isolated mode on and blocks .env before importing the app."""
    from app.core.config import settings

    assert isolation.isolated_mode()
    assert os.environ.get("DATABASE_URL") is not None
    assert "supabase" not in settings.database_url


# ---------- the incident, rebuilt in a subprocess ----------


def _run(code: str, env_extra: dict[str, str], tmp_path: Path) -> subprocess.CompletedProcess:
    (tmp_path / ".env").write_text(f"DATABASE_URL={LIVE_LIKE}\n")  # like apps/api/.env
    env = {k: v for k, v in os.environ.items() if k not in {"DATABASE_URL", "LUNTI_ISOLATED_TEST"}}
    env.update(PYTHONPATH=str(API_DIR), **env_extra)
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(code)],
        cwd=tmp_path,  # settings read .env from the working directory
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


GET_ENGINE = """
    from app.core.config import settings
    from app.core.db import get_engine
    assert "supabase.co" in settings.database_url  # .env's live-looking URL was loaded
    try:
        get_engine()
    except Exception as exc:
        print(type(exc).__name__, exc)
    else:
        print("ENGINE CREATED")
"""


def test_isolated_server_cannot_fall_back_to_the_live_env_url(tmp_path: Path) -> None:
    result = _run(GET_ENGINE, {"LUNTI_ISOLATED_TEST": "1"}, tmp_path)
    assert result.returncode == 0, result.stderr
    assert "IsolationError" in result.stdout
    assert "fall back to apps/api/.env" in result.stdout
    assert "ENGINE CREATED" not in result.stdout


def test_isolated_server_startup_fails_before_connecting_to_a_live_url(tmp_path: Path) -> None:
    code = """
        from fastapi.testclient import TestClient
        from app.main import create_app
        try:
            with TestClient(create_app()):
                print("STARTED")
        except Exception as exc:
            print(type(exc).__name__, exc)
    """
    result = _run(code, {"LUNTI_ISOLATED_TEST": "1", "DATABASE_URL": LIVE_LIKE}, tmp_path)
    assert result.returncode == 0, result.stderr
    assert "IsolationError" in result.stdout and "not an approved test host" in result.stdout
    assert "STARTED" not in result.stdout


def test_normal_development_is_unaffected(tmp_path: Path) -> None:
    """Without the flag the engine is created as before (lazily: nothing connects here)."""
    result = _run(GET_ENGINE, {}, tmp_path)
    assert result.returncode == 0, result.stderr
    assert "ENGINE CREATED" in result.stdout


# ---------- the real connected identity (throwaway server) ----------


@pytest.mark.db
def test_unmarked_database_is_refused_even_with_a_test_name(
    database: ThrowawayDatabase,
) -> None:
    """Identity is checked on the server, not taken from the URL: no marker, no connection."""
    server_url = to_sqlalchemy_url(_server_url())
    name = f"lunti_test_{uuid.uuid4().hex[:10]}"
    server = create_engine(server_url, isolation_level="AUTOCOMMIT")
    try:
        with server.connect() as conn:
            conn.execute(text(f'create database "{name}"'))  # NOT marked
        engine = make_engine(make_url(server_url).set(database=name).render_as_string(False))
        with pytest.raises(isolation.IsolationError, match="not a test database"):
            with engine.connect():
                pass
        engine.dispose()
    finally:
        with server.connect() as conn:
            conn.execute(text(f'drop database if exists "{name}" with (force)'))
        server.dispose()


@pytest.mark.db
def test_marked_test_database_connects_and_reports_its_identity(
    database: ThrowawayDatabase,
) -> None:
    engine = make_engine(database.app_url)
    try:
        with engine.connect() as conn:
            assert (
                conn.execute(text("select current_database()")).scalar().startswith("lunti_test_")
            )
            raw = conn.connection.dbapi_connection
            assert isolation.verify_identity(raw).startswith("lunti_test_")
    finally:
        engine.dispose()


@pytest.mark.db
def test_engine_for_the_servers_own_database_is_refused_before_connecting() -> None:
    url = make_url(to_sqlalchemy_url(_server_url())).set(database="postgres")
    with pytest.raises(isolation.IsolationError, match="only lunti_test_"):
        make_engine(url.render_as_string(hide_password=False))
