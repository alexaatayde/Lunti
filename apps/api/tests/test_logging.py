"""Production-safe logging (Phase 8B): request ids, access lines without query strings,
redaction of secrets and personal data, and tracebacks without exception messages."""

import io
import json
import logging
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from app.core import logging as app_logging
from app.core.config import settings
from app.core.logging import (
    JsonFormatter,
    RequestIdFilter,
    TextFormatter,
    configure_logging,
    redact,
    route_template,
)
from app.main import app

TOKEN = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl"


@pytest.fixture
def captured() -> Iterator[io.StringIO]:
    """Everything logged during the test, through a handler like the app's (text format)."""
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(RequestIdFilter())
    handler.setFormatter(TextFormatter())
    root = logging.getLogger()
    previous = root.level
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    yield stream
    root.removeHandler(handler)
    root.setLevel(previous)


# ---------- redaction ----------


@pytest.mark.parametrize(
    ("raw", "secret"),
    [
        (f"Authorization: Bearer {TOKEN}", TOKEN),
        ("authorization=Bearer abc.def-ghi", "abc.def-ghi"),
        (f"token {TOKEN} expired", TOKEN),
        ("OPENAI key sk-proj-AbCdEfGhIjKlMnOpQrSt used", "sk-proj-AbCdEfGhIjKlMnOpQrSt"),
        ("postgresql://postgres.ref:Sup3r%40Secret@db.example.com:5432/x", "Sup3r%40Secret"),
        ('{"password": "hunter22"}', "hunter22"),
        ("api_key=AIzaSyA-123456789", "AIzaSyA-123456789"),
        ("service_role_key: srk-123456", "srk-123456"),
        ("refresh_token=rt-abcdef", "rt-abcdef"),
        ("GET https://x.supabase.co/storage/v1/object/sign/r.jpg?token=abc123 200", "abc123"),
        ('"GET /api/v1/transactions?q=pharmacy HTTP/1.1" 200', "pharmacy"),
        ("signed up as juan.delacruz@example.com", "juan.delacruz@example.com"),
    ],
)
def test_redact_masks_secrets_and_personal_data(raw: str, secret: str) -> None:
    out = redact(raw)
    assert secret not in out
    assert "[REDACTED]" in out or "[email]" in out


def test_redact_keeps_ordinary_operational_text() -> None:
    line = "POST /api/v1/transactions/{transaction_id} 201 12.3ms"
    assert redact(line) == line
    assert redact("Receipt cleanup: {'drafts': 2}") == "Receipt cleanup: {'drafts': 2}"


# ---------- request log ----------


def test_route_template_hides_ids_and_query() -> None:
    tid = str(uuid.uuid4())
    scope = {
        "path": f"/api/v1/transactions/{tid}",
        "path_params": {"transaction_id": uuid.UUID(tid)},
        "route": object(),
    }
    assert route_template(scope) == "/api/v1/transactions/{transaction_id}"
    unmatched = {"path": f"/api/v1/x/{tid}/y/z/w", "path_params": {}, "route": None}
    assert route_template(unmatched) == "/api/v1/x/…"


def test_access_line_has_route_status_duration_and_id_but_no_query_or_token(
    client: TestClient, tokens, captured: io.StringIO
) -> None:
    rid = "test-request-0001"
    response = client.get(
        "/api/v1/transactions?q=SecretPharmacy&cursor=abc",
        headers={"Authorization": f"Bearer {TOKEN}", "X-Request-ID": rid},
    )
    assert response.status_code == 401  # the test token isn't signed by the test key set
    assert response.headers["X-Request-ID"] == rid

    logs = captured.getvalue()
    access = [line for line in logs.splitlines() if "lunti.access" in line]
    assert len(access) == 1
    assert f"[{rid}]" in access[0]
    assert "GET /api/v1/transactions 401" in access[0] and "ms" in access[0]
    assert "SecretPharmacy" not in logs and "cursor" not in logs
    assert TOKEN not in logs


def test_a_malformed_request_id_is_replaced(client: TestClient) -> None:
    response = client.get("/health", headers={"X-Request-ID": "bad id\nwith newline"})
    assert response.headers["X-Request-ID"] != "bad id\nwith newline"
    assert len(response.headers["X-Request-ID"]) == 32
    other = client.get("/health")
    assert other.headers["X-Request-ID"] != response.headers["X-Request-ID"]


def test_uvicorn_access_log_is_switched_off() -> None:
    configure_logging()
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, "", 0, '%s "%s %s"', ("1.2.3.4", "GET", "/x?q=1"), None
    )
    assert not logging.getLogger("uvicorn.access").filter(record)
    assert logging.getLogger("uvicorn.access").propagate is False


def test_unhandled_errors_log_route_and_type_with_the_request_id(
    client: TestClient, captured: io.StringIO
) -> None:
    @app.get("/__boom_logging_test")
    def boom() -> None:
        raise ValueError("amount 1234.56 for Juan's pharmacy note")

    try:
        response = client.get("/__boom_logging_test", headers={"X-Request-ID": "boom-request-1"})
    finally:
        app.router.routes[:] = [
            r for r in app.router.routes if getattr(r, "path", "") != "/__boom_logging_test"
        ]
    assert response.status_code == 500
    assert response.json()["detail"] == "Something went wrong. Please try again."
    logs = captured.getvalue()
    assert "Unhandled error in GET /__boom_logging_test: ValueError" in logs
    assert "[boom-request-1]" in logs


# ---------- production formatting ----------


def _record_with_exception(message: str) -> logging.LogRecord:
    try:
        raise ValueError("amount 1234.56 for Juan's pharmacy note")
    except ValueError:
        import sys

        record = logging.LogRecord("app", logging.ERROR, __file__, 1, message, (), sys.exc_info())
    record.request_id = "req-123456"
    return record


def test_production_json_drops_exception_messages_but_keeps_locations() -> None:
    line = JsonFormatter().format(_record_with_exception("Unhandled error: ValueError"))
    entry = json.loads(line)
    assert entry["level"] == "ERROR" and entry["request_id"] == "req-123456"
    assert entry["error_type"] == "ValueError"
    assert "test_logging.py" in entry["traceback"]
    assert "1234.56" not in line and "pharmacy" not in line


def test_production_text_drops_exception_messages_development_keeps_them() -> None:
    record = _record_with_exception("failed")
    production = TextFormatter(sanitize_exceptions=True).format(record)
    record.exc_text = None  # the formatter caches the formatted traceback on the record
    development = TextFormatter(sanitize_exceptions=False).format(record)
    assert "1234.56" not in production and "ValueError" in production
    assert "1234.56" in development


def test_production_settings_select_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "log_format", "")
    try:
        configure_logging()
        handler = next(h for h in logging.getLogger().handlers if getattr(h, "_lunti_handler", 0))
        assert isinstance(handler.formatter, JsonFormatter)
    finally:
        monkeypatch.setattr(settings, "app_env", "development")
        configure_logging()
    handler = next(h for h in logging.getLogger().handlers if getattr(h, "_lunti_handler", 0))
    assert isinstance(handler.formatter, TextFormatter)


def test_configure_logging_is_idempotent() -> None:
    configure_logging()
    configure_logging()
    ours = [h for h in logging.getLogger().handlers if getattr(h, "_lunti_handler", False)]
    assert len(ours) == 1
    assert app_logging.logging.getLogger("httpx").level == logging.WARNING


# ---------- SQL parameters ----------


@pytest.mark.db
def test_database_errors_do_not_carry_parameter_values_into_production_logs(
    app_engine,  # noqa: ANN001
) -> None:
    """Two layers: SQLAlchemy's parameter dump is hidden everywhere (hide_parameters), and
    Postgres's own message — which can echo a value, e.g. "invalid input syntax ... 'Juan…'" —
    is dropped from production logs with every other exception message."""
    assert settings.log_sql_parameters is False
    with pytest.raises(DBAPIError) as caught, app_engine.connect() as conn:
        conn.execute(text("select cast(:v as integer)"), {"v": "Juan pharmacy 1234.56"})
    assert "SQL parameters hidden due to hide_parameters=True" in str(caught.value)

    record = logging.LogRecord(
        "app",
        logging.ERROR,
        __file__,
        1,
        "Unhandled error",
        (),
        (type(caught.value), caught.value, caught.value.__traceback__),
    )
    record.request_id = "req-123456"
    assert "Juan pharmacy" not in JsonFormatter().format(record)
    record.exc_text = None
    assert "Juan pharmacy" not in TextFormatter(sanitize_exceptions=True).format(record)


@pytest.mark.db
def test_parameters_can_be_shown_when_explicitly_enabled(database) -> None:  # noqa: ANN001
    from app.core.config import to_sqlalchemy_url

    engine = create_engine(to_sqlalchemy_url(database.app_url), hide_parameters=False)
    try:
        with pytest.raises(DBAPIError) as caught, engine.connect() as conn:
            conn.execute(text("select cast(:v as integer)"), {"v": "visible-value"})
        assert "visible-value" in str(caught.value)
    finally:
        engine.dispose()
