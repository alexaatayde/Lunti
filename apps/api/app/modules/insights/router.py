"""`/insights` (AGENTS.md §7.7, §9)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from app.core.auth import CurrentUserDep
from app.core.db import UserDbDep
from app.core.errors import PROBLEM_JSON, PROBLEM_RESPONSES, Problem
from app.modules.insights import service
from app.modules.insights.schemas import InsightOut, InsightsPage
from app.modules.insights.writer import InsightWriter, get_writer

router = APIRouter(prefix="/insights", tags=["insights"], responses=PROBLEM_RESPONSES)
WriterDep = Annotated[InsightWriter, Depends(get_writer)]


@router.get(
    "",
    response_model=InsightsPage,
    summary="Today's insights (or a 'need more data' placeholder)",
)
def list_insights(user: CurrentUserDep, db: UserDbDep, writer: WriterDep) -> InsightsPage:
    return service.list_insights(db, user, writer)


@router.post(
    "/{insight_id}/dismiss",
    response_model=InsightOut,
    summary="Hide an insight",
    responses={404: {"model": Problem, "content": {PROBLEM_JSON: {}}, "description": "Not found."}},
)
def dismiss(insight_id: UUID, user: CurrentUserDep, db: UserDbDep) -> InsightOut:
    return service.dismiss(db, user, insight_id)
