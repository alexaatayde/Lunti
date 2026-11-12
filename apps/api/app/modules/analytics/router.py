"""`/analytics` (AGENTS.md §9, SRS 3.1.4–3.1.5)."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.core.auth import CurrentUserDep
from app.core.db import UserDbDep
from app.core.errors import PROBLEM_RESPONSES
from app.modules.analytics import service
from app.modules.analytics.schemas import AnalyticsSummary, Period, ProductPattern

router = APIRouter(prefix="/analytics", tags=["analytics"], responses=PROBLEM_RESPONSES)


@router.get(
    "/summary",
    response_model=AnalyticsSummary,
    summary="Spending so far this day/week/month vs the same span of the previous one",
)
def analytics_summary(
    user: CurrentUserDep,
    db: UserDbDep,
    period: Annotated[Period, Query()] = "monthly",
) -> AnalyticsSummary:
    return service.summary(db, user, period)


@router.get(
    "/patterns",
    response_model=list[ProductPattern],
    summary="How often each product is bought, with its data tier (sufficient/limited/"
    "insufficient)",
)
def analytics_patterns(user: CurrentUserDep, db: UserDbDep) -> list[ProductPattern]:
    return service.list_patterns(db, user)
