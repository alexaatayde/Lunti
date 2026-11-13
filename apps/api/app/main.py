from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute
from sqlalchemy import text

import app.models  # noqa: F401  (registers every table, so foreign keys resolve at runtime)
from app.core.body_limit import BodySizeLimitMiddleware
from app.core.config import settings
from app.core.db import get_engine
from app.core.errors import PROBLEM_JSON, Problem, register_error_handlers
from app.core.logging import RequestLogMiddleware, configure_logging
from app.jobs.scheduler import start_scheduler
from app.modules.analytics.router import router as analytics_router
from app.modules.expenses.budgets_router import router as budgets_router
from app.modules.expenses.router import router as categories_router
from app.modules.expenses.transactions_router import router as transactions_router
from app.modules.insights.router import router as insights_router
from app.modules.meals.router import admin_router, pantry_router, recipes_router
from app.modules.notifications.router import devices_router, notifications_router
from app.modules.receipts.router import router as receipts_router
from app.modules.replenishment.router import replenishment_router, shopping_router
from app.modules.users.router import router as me_router


def _operation_id(route: APIRoute) -> str:
    # Stable, readable ids for the generated TypeScript client (e.g. "get_me").
    return route.name


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Scheduled jobs (AGENTS.md §7.6) run in this process when SCHEDULER_ENABLED=true.
    scheduler = start_scheduler()
    try:
        yield
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)


def health() -> dict[str, str]:
    return {"status": "ok"}


def health_db() -> dict[str, str]:
    """Checks the database connection (no data is read)."""
    with get_engine().connect() as connection:
        connection.execute(text("select 1"))
    return {"database": "ok"}


def docs_urls(production: bool) -> dict[str, str | None]:
    """Swagger UI, ReDoc and the OpenAPI JSON are for development and tests. In production
    (APP_ENV=production) they are not served (404): the route list is no help to anyone but
    an attacker. The spec is still built in code (`app.openapi()`), which is what
    scripts.export_openapi and the CI contract test use."""
    if production:
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}


def create_app() -> FastAPI:
    configure_logging()
    application = FastAPI(
        title="Lunti API",
        version="0.7.0",
        generate_unique_id_function=_operation_id,
        lifespan=lifespan,
        **docs_urls(settings.is_production),
    )
    register_error_handlers(application)
    # Added last = outermost: every request (a refused oversized one too) gets an id and a
    # log line.
    application.add_middleware(BodySizeLimitMiddleware)
    application.add_middleware(RequestLogMiddleware)

    # Feature module routers (AGENTS.md §9). All require `Authorization: Bearer <supabase jwt>`.
    api_v1 = APIRouter(prefix="/api/v1")
    for router in (
        me_router,
        categories_router,
        transactions_router,
        budgets_router,
        receipts_router,
        analytics_router,
        replenishment_router,
        shopping_router,
        notifications_router,
        devices_router,
        pantry_router,
        recipes_router,
        insights_router,
        admin_router,
    ):
        api_v1.include_router(router)
    application.include_router(api_v1)

    application.add_api_route("/health", health, methods=["GET"], tags=["meta"])
    application.add_api_route(
        "/health/db",
        health_db,
        methods=["GET"],
        tags=["meta"],
        responses={503: {"model": Problem, "content": {PROBLEM_JSON: {}}}},
    )
    return application


app = create_app()
