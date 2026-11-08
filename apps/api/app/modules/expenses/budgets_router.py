"""`/budgets` (AGENTS.md §9, SRS 3.1.3)."""

from uuid import UUID

from fastapi import APIRouter, Response, status

from app.core.auth import CurrentUserDep
from app.core.db import UserDbDep
from app.core.errors import PROBLEM_JSON, PROBLEM_RESPONSES, Problem
from app.modules.expenses import budget_service as service
from app.modules.expenses.schemas import Budget, BudgetCreate, BudgetStatus, BudgetUpdate

router = APIRouter(prefix="/budgets", tags=["budgets"], responses=PROBLEM_RESPONSES)

_problem = {"model": Problem, "content": {PROBLEM_JSON: {}}}
_NOT_FOUND = {404: {**_problem, "description": "Budget not found."}}
_CONFLICT = {409: {**_problem, "description": "A budget like this already covers these dates."}}


@router.get("", response_model=list[Budget], summary="List budgets")
def list_budgets(user: CurrentUserDep, db: UserDbDep) -> list[Budget]:
    return service.list_budgets(db, user)


@router.get(
    "/status",
    response_model=list[BudgetStatus],
    summary="Spent, remaining and level of every budget for its current period",
)
def budgets_status(user: CurrentUserDep, db: UserDbDep) -> list[BudgetStatus]:
    return service.list_status(db, user)


@router.post(
    "",
    response_model=BudgetStatus,
    status_code=status.HTTP_201_CREATED,
    summary="Create a budget",
    responses=_CONFLICT,
)
def create_budget(body: BudgetCreate, user: CurrentUserDep, db: UserDbDep) -> BudgetStatus:
    return service.create_budget(db, user, body)


@router.get(
    "/{budget_id}",
    response_model=BudgetStatus,
    summary="A budget with its current status",
    responses=_NOT_FOUND,
)
def get_budget(budget_id: UUID, user: CurrentUserDep, db: UserDbDep) -> BudgetStatus:
    return service.get_status(db, user, budget_id)


@router.patch(
    "/{budget_id}",
    response_model=BudgetStatus,
    summary="Edit a budget",
    responses={**_NOT_FOUND, **_CONFLICT},
)
def update_budget(
    budget_id: UUID, body: BudgetUpdate, user: CurrentUserDep, db: UserDbDep
) -> BudgetStatus:
    return service.update_budget(db, user, budget_id, body)


@router.delete(
    "/{budget_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a budget (transactions are kept)",
    responses=_NOT_FOUND,
)
def delete_budget(budget_id: UUID, user: CurrentUserDep, db: UserDbDep) -> Response:
    service.delete_budget(db, user, budget_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
