"""`/replenishment` and `/shopping-lists` (AGENTS.md §9, SRS 3.1.6–3.1.7)."""

from uuid import UUID

from fastapi import APIRouter, Response, status

from app.core.auth import CurrentUserDep
from app.core.db import UserDbDep
from app.core.errors import PROBLEM_JSON, PROBLEM_RESPONSES, Problem
from app.modules.replenishment import service, shopping
from app.modules.replenishment.schemas import (
    FeedbackResult,
    ItemCreate,
    ItemUpdate,
    MutedProduct,
    ShoppingList,
    ShoppingListItem,
    Suggestion,
    SuggestionFeedback,
)

_problem = {"model": Problem, "content": {PROBLEM_JSON: {}}}

replenishment_router = APIRouter(
    prefix="/replenishment", tags=["replenishment"], responses=PROBLEM_RESPONSES
)
shopping_router = APIRouter(
    prefix="/shopping-lists", tags=["shopping-lists"], responses=PROBLEM_RESPONSES
)


@replenishment_router.get(
    "/suggestions",
    response_model=list[Suggestion],
    summary="Restock suggestions that are due (soonest first)",
)
def list_suggestions(user: CurrentUserDep, db: UserDbDep) -> list[Suggestion]:
    return service.list_suggestions(db, user)


@replenishment_router.post(
    "/suggestions/{suggestion_id}/feedback",
    response_model=FeedbackResult,
    summary="Answer a suggestion: add to list, still have some, bought elsewhere, don't "
    "remind, dismiss or modify",
    responses={
        404: {**_problem, "description": "Suggestion not found."},
        409: {**_problem, "description": "The suggestion was already answered."},
    },
)
def suggestion_feedback(
    suggestion_id: UUID, body: SuggestionFeedback, user: CurrentUserDep, db: UserDbDep
) -> FeedbackResult:
    return service.give_feedback(db, user, suggestion_id, body)


@replenishment_router.get(
    "/muted",
    response_model=list[MutedProduct],
    summary="Products you chose not to be reminded about",
)
def list_muted(user: CurrentUserDep, db: UserDbDep) -> list[MutedProduct]:
    return service.list_muted(db, user)


@replenishment_router.delete(
    "/muted/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Turn restock reminders back on for a product (also Undo for 'Don't remind')",
    responses={404: {**_problem, "description": "This product isn't muted."}},
)
def unmute(product_id: UUID, user: CurrentUserDep, db: UserDbDep) -> Response:
    service.unmute(db, user, product_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@shopping_router.get(
    "", response_model=list[ShoppingList], summary="Your shopping list with estimated totals"
)
def list_shopping_lists(user: CurrentUserDep, db: UserDbDep) -> list[ShoppingList]:
    return shopping.list_lists(db, user)


_NOT_FOUND = {404: {**_problem, "description": "List or item not found."}}
_DUPLICATE = {409: {**_problem, "description": "An unbought item with this name exists."}}


@shopping_router.post(
    "/{list_id}/items",
    response_model=ShoppingListItem,
    status_code=status.HTTP_201_CREATED,
    summary="Add an item",
    responses={**_NOT_FOUND, **_DUPLICATE},
)
def add_item(
    list_id: UUID, body: ItemCreate, user: CurrentUserDep, db: UserDbDep
) -> ShoppingListItem:
    return shopping.add_item(db, user, list_id, body)


@shopping_router.patch(
    "/{list_id}/items/{item_id}",
    response_model=ShoppingListItem,
    summary="Edit an item or tick it off",
    responses={**_NOT_FOUND, **_DUPLICATE},
)
def update_item(
    list_id: UUID, item_id: UUID, body: ItemUpdate, user: CurrentUserDep, db: UserDbDep
) -> ShoppingListItem:
    return shopping.update_item(db, user, list_id, item_id, body)


@shopping_router.delete(
    "/{list_id}/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove an item",
    responses=_NOT_FOUND,
)
def delete_item(list_id: UUID, item_id: UUID, user: CurrentUserDep, db: UserDbDep) -> Response:
    shopping.delete_item(db, user, list_id, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
