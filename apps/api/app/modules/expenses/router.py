"""`/categories` (AGENTS.md §9)."""

from uuid import UUID

from fastapi import APIRouter, Response, status

from app.core.auth import CurrentUserDep
from app.core.db import UserDbDep
from app.core.errors import PROBLEM_JSON, PROBLEM_RESPONSES, Problem
from app.modules.expenses import service
from app.modules.expenses.schemas import Category, CategoryCreate, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"], responses=PROBLEM_RESPONSES)

_problem = {"model": Problem, "content": {PROBLEM_JSON: {}}}
_ITEM_ERRORS = {
    403: {**_problem, "description": "Default categories can't be changed."},
    404: {**_problem, "description": "Category not found."},
    409: {**_problem, "description": "Name already used, or category still in use."},
}


@router.get("", response_model=list[Category], summary="List default and own categories")
def list_categories(user: CurrentUserDep, db: UserDbDep) -> list[Category]:
    return [Category.model_validate(c) for c in service.list_categories(db, user)]


@router.post(
    "",
    response_model=Category,
    status_code=status.HTTP_201_CREATED,
    summary="Create a category",
    responses={409: _ITEM_ERRORS[409]},
)
def create_category(body: CategoryCreate, user: CurrentUserDep, db: UserDbDep) -> Category:
    return Category.model_validate(service.create_category(db, user, body))


@router.patch(
    "/{category_id}",
    response_model=Category,
    summary="Rename or change the icon of an own category",
    responses=_ITEM_ERRORS,
)
def update_category(
    category_id: UUID, body: CategoryUpdate, user: CurrentUserDep, db: UserDbDep
) -> Category:
    return Category.model_validate(service.update_category(db, user, category_id, body))


@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an own category that nothing uses",
    responses=_ITEM_ERRORS,
)
def delete_category(category_id: UUID, user: CurrentUserDep, db: UserDbDep) -> Response:
    service.delete_category(db, user, category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
