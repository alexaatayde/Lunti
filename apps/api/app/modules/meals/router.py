"""`/pantry`, `/recipes` and the admin-only `/admin/recipes` (AGENTS.md §7.5, §9)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth import CurrentUserDep
from app.core.db import UserDbDep, get_session_factory
from app.core.errors import PROBLEM_JSON, PROBLEM_RESPONSES, ApiError, Problem
from app.modules.meals import pantry, recipes
from app.modules.meals.schemas import (
    AddMissingResult,
    PantryItem,
    PantryPage,
    PantryUpdate,
    RecipeCreate,
    RecipeDetail,
    Recommendations,
)
from app.modules.users.models import Profile

_problem = {"model": Problem, "content": {PROBLEM_JSON: {}}}

pantry_router = APIRouter(prefix="/pantry", tags=["pantry"], responses=PROBLEM_RESPONSES)
recipes_router = APIRouter(prefix="/recipes", tags=["recipes"], responses=PROBLEM_RESPONSES)
admin_router = APIRouter(prefix="/admin", tags=["admin"], responses=PROBLEM_RESPONSES)


@pantry_router.get("", response_model=PantryPage, summary="Your estimated pantry")
def list_pantry(user: CurrentUserDep, db: UserDbDep) -> PantryPage:
    return pantry.list_pantry(db, user)


@pantry_router.patch(
    "/{item_id}",
    response_model=PantryItem,
    summary="Adjust or confirm an item (any amount you set counts as confirmed)",
    responses={404: {**_problem, "description": "Pantry item not found."}},
)
def update_pantry_item(
    item_id: UUID, body: PantryUpdate, user: CurrentUserDep, db: UserDbDep
) -> PantryItem:
    return pantry.update_item(db, user, item_id, body)


@recipes_router.get(
    "/recommendations",
    response_model=Recommendations,
    summary="Recipes ranked by how much of them your pantry covers",
)
def recommendations(user: CurrentUserDep, db: UserDbDep) -> Recommendations:
    return recipes.recommendations(db, user)


_RECIPE_404 = {404: {**_problem, "description": "Recipe not found."}}


@recipes_router.get(
    "/{recipe_id}",
    response_model=RecipeDetail,
    summary="A recipe with each ingredient's availability",
    responses=_RECIPE_404,
)
def get_recipe(recipe_id: UUID, user: CurrentUserDep, db: UserDbDep) -> RecipeDetail:
    return recipes.get_recipe(db, user, recipe_id)


@recipes_router.post(
    "/{recipe_id}/add-missing",
    response_model=AddMissingResult,
    summary="Add the recipe's missing ingredients to your grocery list",
    responses=_RECIPE_404,
)
def add_missing(recipe_id: UUID, user: CurrentUserDep, db: UserDbDep) -> AddMissingResult:
    return recipes.add_missing(db, user, recipe_id)


@admin_router.post(
    "/recipes",
    response_model=RecipeDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Add a catalog recipe (admins only)",
    responses={403: {**_problem, "description": "Admins only."}},
)
def create_recipe(
    body: RecipeCreate,
    user: CurrentUserDep,
    db: UserDbDep,
    factory: Annotated[sessionmaker[Session], Depends(get_session_factory)],
) -> RecipeDetail:
    role = db.scalar(select(Profile.role).where(Profile.user_id == user.id))
    if role != "admin":
        raise ApiError(403, "forbidden", "Only admins can change the recipe catalog.")
    # The catalog is read-only for the app role (RLS); the write uses the API's own
    # connection, after the role check above.
    with factory() as admin_db, admin_db.begin():
        recipe_id = recipes.create_recipe(admin_db, body)
    return recipes.get_recipe(db, user, recipe_id)
