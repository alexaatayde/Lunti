"""RFC 7807 problem responses (AGENTS.md §9): every error is
`application/problem+json` with `type`, `title`, `status`, `detail` and, for validation, `errors[]`.
"""

import logging
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

PROBLEM_JSON = "application/problem+json"


class FieldError(BaseModel):
    field: str
    message: str
    code: str


class Problem(BaseModel):
    type: str
    title: str
    status: int
    detail: str | None = None
    errors: list[FieldError] = []


def problem_type(slug: str) -> str:
    return f"urn:lunti:problem:{slug}"


class ApiError(Exception):
    """Raise from services/routers to return a problem response."""

    def __init__(
        self,
        status: int,
        slug: str,
        detail: str,
        *,
        title: str | None = None,
        headers: dict[str, str] | None = None,
        errors: list[FieldError] | None = None,
    ) -> None:
        super().__init__(detail)
        self.status = status
        self.slug = slug
        self.detail = detail
        self.title = title or HTTPStatus(status).phrase
        self.headers = headers
        self.errors = errors


def not_found(what: str) -> ApiError:
    return ApiError(404, "not-found", f"{what} not found.")


def invalid_field(field: str, message: str, code: str = "invalid") -> ApiError:
    """422 for a rule checked in a service (e.g. "that category isn't yours"), shaped like
    request validation errors so the app can show it next to the field."""
    return ApiError(
        422,
        "validation-error",
        "The request has invalid fields.",
        errors=[FieldError(field=field, message=message, code=code)],
    )


def problem_response(
    status: int,
    slug: str,
    detail: str | None,
    *,
    title: str | None = None,
    errors: list[FieldError] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body = Problem(
        type=problem_type(slug),
        title=title or HTTPStatus(status).phrase,
        status=status,
        detail=detail,
        errors=errors or [],
    )
    return JSONResponse(
        body.model_dump(), status_code=status, media_type=PROBLEM_JSON, headers=headers
    )


def _field_name(loc: tuple[Any, ...]) -> str:
    # ("body", "budget_alert_pct") → "budget_alert_pct"; ("query", "q") → "q"
    parts = [str(p) for p in loc if p not in ("body", "query", "path", "header")]
    return ".".join(parts) or "body"


async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
    return problem_response(
        exc.status, exc.slug, exc.detail, title=exc.title, errors=exc.errors, headers=exc.headers
    )


async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = [
        FieldError(field=_field_name(tuple(e["loc"])), message=e["msg"], code=e["type"])
        for e in exc.errors()
    ]
    return problem_response(
        422, "validation-error", "The request has invalid fields.", errors=errors
    )


async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    slug = {404: "not-found", 405: "method-not-allowed", 413: "payload-too-large"}.get(
        exc.status_code, "http-error"
    )
    detail = exc.detail if isinstance(exc.detail, str) else None
    return problem_response(exc.status_code, slug, detail, headers=exc.headers)


async def _database_unavailable(_: Request, exc: OperationalError) -> JSONResponse:
    logger.error("Database unavailable: %s", exc.__class__.__name__)
    return problem_response(
        503,
        "service-unavailable",
        "The service is temporarily unavailable. Please try again.",
        headers={"Retry-After": "5"},
    )


async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
    # The route template (never the raw URL or query); in production the log formatter keeps
    # only the exception type and code locations (app/core/logging.py).
    route = getattr(request.scope.get("route"), "path", "(unmatched)")
    logger.error(
        "Unhandled error in %s %s: %s",
        request.method,
        route,
        type(exc).__qualname__,
        exc_info=exc,
    )
    return problem_response(500, "internal-error", "Something went wrong. Please try again.")


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _api_error)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _validation_error)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, _http_error)  # type: ignore[arg-type]
    app.add_exception_handler(OperationalError, _database_unavailable)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, _unexpected)


# Shared OpenAPI declarations so the generated client knows the error shape.
PROBLEM_RESPONSES: dict[int | str, dict[str, Any]] = {
    status: {"model": Problem, "content": {PROBLEM_JSON: {}}, "description": desc}
    for status, desc in {
        401: "Missing, invalid or expired access token.",
        422: "Validation error.",
        503: "Service temporarily unavailable.",
    }.items()
}
