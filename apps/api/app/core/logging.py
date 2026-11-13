"""Production-safe logging (Phase 8B).

- Every request gets a request id (`X-Request-ID`: the client's, if well formed, else a new
  one), returned in the response and attached to every log line written while handling it.
- One access line per request: method, ROUTE TEMPLATE (e.g. /api/v1/transactions/{transaction_id}),
  status and duration. Never the query string (search text, cursors), headers or bodies.
  Uvicorn's own access log is switched off; it prints the raw URL with its query string.
- Every log line passes a redactor: bearer tokens, JWTs, API keys, passwords, database URL
  passwords, e-mail addresses and URL query strings are masked, whatever logger wrote them.
- Production (APP_ENV=production): JSON lines, and tracebacks keep the exception type and the
  code location of each frame but drop the exception message, which can carry user data.
  Development: readable text with full tracebacks (still redacted).
- SQL parameter values are kept out of database error messages (create_engine
  hide_parameters; see LOG_SQL_PARAMETERS in config.py).
"""

import json
import logging
import re
import time
import traceback
import uuid
from contextvars import ContextVar
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings

REQUEST_ID_HEADER = "x-request-id"
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

access_logger = logging.getLogger("lunti.access")

REDACTED = "[REDACTED]"
_REDACTIONS: list[tuple[re.Pattern[str], str]] = [
    # Authorization header values and bearer tokens.
    (re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+"), r"\1 " + REDACTED),
    # JSON Web Tokens anywhere (Supabase access tokens, signed storage URLs).
    (re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*"), REDACTED),
    # OpenAI-style secret keys.
    (re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"), REDACTED),
    # Passwords in connection URLs: scheme://user:password@host
    (re.compile(r"(\b[a-z][a-z0-9+.-]*://[^:/\s@]+:)[^@\s]+@"), r"\1" + REDACTED + "@"),
    # key=value / "key": "value" secrets.
    (
        re.compile(
            r"(?i)\b((?:access|refresh|id)?_?token|api[_-]?key|apikey|password|passwd|secret"
            r"|authorization|service[_-]?role[_-]?key|client[_-]?secret)"
            r"(\"?'?\s*[:=]\s*\"?'?)[^\s\"'&,;}]+"
        ),
        r"\1\2" + REDACTED,
    ),
    # Query strings of URLs and request targets (search text, cursors, signed-URL tokens).
    (re.compile(r"((?:https?://[^\s?\"'<>]+|\s/[^\s?\"'<>]*))\?[^\s\"'<>]+"), r"\1?" + REDACTED),
    # E-mail addresses.
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[email]"),
]


def redact(text: str) -> str:
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


def sanitized_traceback(exc_info: Any) -> str:
    """Exception types and code locations only: messages (which may contain amounts, names or
    notes) are left out."""
    _, exc, tb = exc_info
    lines = ["Traceback (most recent call last, messages omitted):"]
    lines += [
        f'  File "{f.filename}", line {f.lineno}, in {f.name}' for f in traceback.extract_tb(tb)
    ]
    chain = []
    seen = exc
    while seen is not None and len(chain) < 5:
        chain.append(type(seen).__qualname__)
        seen = seen.__cause__ or seen.__context__
    lines.append("Exception: " + " <- ".join(chain))
    return "\n".join(lines)


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get() or "-"
        return True


class DropFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return False


class TextFormatter(logging.Formatter):
    def __init__(self, *, sanitize_exceptions: bool = False) -> None:
        super().__init__("%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s")
        self.sanitize_exceptions = sanitize_exceptions

    def formatException(self, ei: Any) -> str:  # noqa: N802 (logging API)
        return sanitized_traceback(ei) if self.sanitize_exceptions else super().formatException(ei)

    def format(self, record: logging.LogRecord) -> str:
        if not hasattr(record, "request_id"):
            record.request_id = "-"
        return redact(super().format(record))


ACCESS_FIELDS = ("method", "route", "status", "duration_ms")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", None) or "-",
            "message": record.getMessage(),
        }
        for field in ACCESS_FIELDS:
            if hasattr(record, field):
                entry[field] = getattr(record, field)
        if record.exc_info:
            entry["error_type"] = type(record.exc_info[1]).__qualname__
            entry["traceback"] = sanitized_traceback(record.exc_info)
        return redact(json.dumps(entry, default=str))


_CONFIGURED = "_lunti_handler"


def configure_logging() -> None:
    """Idempotent. Called when the app is created (after uvicorn configured its loggers)."""
    fmt = (settings.log_format or ("json" if settings.is_production else "text")).lower()
    formatter: logging.Formatter = (
        JsonFormatter()
        if fmt == "json"
        else TextFormatter(sanitize_exceptions=settings.is_production)
    )
    root = logging.getLogger()
    handler = next((h for h in root.handlers if getattr(h, _CONFIGURED, False)), None)
    if handler is None:
        handler = logging.StreamHandler()
        setattr(handler, _CONFIGURED, True)
        handler.addFilter(RequestIdFilter())
        root.addHandler(handler)
    handler.setFormatter(formatter)
    root.setLevel(settings.log_level.upper())

    # Uvicorn's loggers go through the same (redacting) handler; its access log is replaced
    # by RequestLogMiddleware, which never prints query strings.
    for name in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
    access = logging.getLogger("uvicorn.access")
    access.handlers.clear()
    access.propagate = False
    if not any(isinstance(f, DropFilter) for f in access.filters):
        access.addFilter(DropFilter())
    # HTTP client request lines include full URLs (storage paths, signed URLs).
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


_ID_SEGMENT = re.compile(
    r"^(?:[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}|\d+)$"
)


def route_template(scope: Scope) -> str:
    """The request path with its path parameters as placeholders, e.g.
    /api/v1/transactions/{transaction_id}. Unmatched paths keep only their shape: id-like
    segments become {id} and the rest is cut after three segments."""
    params = {str(v).lower(): k for k, v in (scope.get("path_params") or {}).items()}
    segments = scope["path"].split("/")
    out = []
    for segment in segments:
        if segment and segment.lower() in params:
            out.append("{" + params[segment.lower()] + "}")
        elif _ID_SEGMENT.match(segment):
            out.append("{id}")
        else:
            out.append(segment)
    if scope.get("route") is None and len(out) > 4:
        out = [*out[:4], "…"]
    return "/".join(out) or "/"


class RequestLogMiddleware:
    """Pure ASGI: request id + one access line per request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = next(
            (v.decode("latin-1") for k, v in scope["headers"] if k == REQUEST_ID_HEADER.encode()),
            "",
        )
        request_id = incoming if _REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status = 500

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = list(message.get("headers", []))
                headers.append((REQUEST_ID_HEADER.encode(), request_id.encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            # The request id is left set if the app raised: the 500 handler runs after this
            # and logs with it. Each request runs in its own context, so it can't leak.
            template = route_template(scope)
            duration = round((time.perf_counter() - started) * 1000, 1)
            access_logger.info(
                "%s %s %s %.1fms",
                scope["method"],
                template,
                status,
                duration,
                extra={
                    "method": scope["method"],
                    "route": template,
                    "status": status,
                    "duration_ms": duration,
                },
            )
        request_id_var.reset(token)
