from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute
from sqlalchemy import text

import app.models  # noqa: F401  (registers every table, so foreign keys resolve at runtime)
from app.core.db import get_engine
from app.core.errors import PROBLEM_JSON, Problem, register_error_handlers
from app.modules.expenses.budgets_router import router as budgets_router
from app.modules.expenses.router import router as categories_router
from app.modules.expenses.transactions_router import router as transactions_router
from app.modules.receipts.router import router as receipts_router
from app.modules.users.router import router as me_router


def _operation_id(route: APIRoute) -> str:
    # Stable, readable ids for the generated TypeScript client (e.g. "get_me").
    return route.name


app = FastAPI(
    title="Lunti API",
    version="0.4.0",
    generate_unique_id_function=_operation_id,
)
register_error_handlers(app)

# Feature module routers (AGENTS.md §9). All require `Authorization: Bearer <supabase jwt>`.
api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(me_router)
api_v1.include_router(categories_router)
api_v1.include_router(transactions_router)
api_v1.include_router(budgets_router)
api_v1.include_router(receipts_router)
app.include_router(api_v1)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get(
    "/health/db",
    tags=["meta"],
    responses={503: {"model": Problem, "content": {PROBLEM_JSON: {}}}},
)
def health_db() -> dict[str, str]:
    """Checks the database connection (no data is read)."""
    with get_engine().connect() as connection:
        connection.execute(text("select 1"))
    return {"database": "ok"}
