"""`/transactions` (AGENTS.md §9, SRS 3.1.1)."""

from collections.abc import Callable
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.auth import CurrentUserDep
from app.core.db import UserDbDep
from app.core.errors import PROBLEM_JSON, PROBLEM_RESPONSES, Problem
from app.modules.expenses import transaction_service as service
from app.modules.expenses.schemas import (
    TransactionCreate,
    TransactionDetail,
    TransactionPage,
    TransactionSaved,
    TransactionSummary,
    TransactionUpdate,
)
from app.modules.receipts.storage import ReceiptStorage, storage_provider

router = APIRouter(prefix="/transactions", tags=["transactions"], responses=PROBLEM_RESPONSES)

_problem = {"model": Problem, "content": {PROBLEM_JSON: {}}}
_NOT_FOUND = {404: {**_problem, "description": "Transaction not found."}}

# Shared filters for the list and the summary. Dates are local days (Asia/Manila), inclusive.
From = Annotated[date | None, Query(alias="from", description="First day, inclusive.")]
To = Annotated[date | None, Query(alias="to", description="Last day, inclusive.")]
CategoryFilter = Annotated[UUID | None, Query()]
Search = Annotated[
    str | None,
    Query(min_length=1, max_length=100, description="Store, note or item name contains."),
]


@router.get("", response_model=TransactionPage, summary="List transactions, newest first")
def list_transactions(
    user: CurrentUserDep,
    db: UserDbDep,
    date_from: From = None,
    date_to: To = None,
    category_id: CategoryFilter = None,
    q: Search = None,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=service.MAX_PAGE_SIZE)] = service.DEFAULT_PAGE_SIZE,
) -> TransactionPage:
    return service.list_transactions(
        db,
        user,
        date_from=date_from,
        date_to=date_to,
        category_id=category_id,
        q=q.strip() if q else None,
        cursor=cursor,
        limit=limit,
    )


@router.get(
    "/summary",
    response_model=TransactionSummary,
    summary="Totals for the same filters as the list (all pages)",
)
def transactions_summary(
    user: CurrentUserDep,
    db: UserDbDep,
    date_from: From = None,
    date_to: To = None,
    category_id: CategoryFilter = None,
    q: Search = None,
) -> TransactionSummary:
    return service.summarize(
        db,
        user,
        date_from=date_from,
        date_to=date_to,
        category_id=category_id,
        q=q.strip() if q else None,
    )


@router.post(
    "",
    response_model=TransactionSaved,
    status_code=status.HTTP_201_CREATED,
    summary="Record a manual expense (recalculates budgets)",
)
def create_transaction(
    body: TransactionCreate, user: CurrentUserDep, db: UserDbDep
) -> TransactionSaved:
    return service.create_transaction(db, user, body)


@router.get(
    "/{transaction_id}",
    response_model=TransactionDetail,
    summary="A transaction with its items and the budgets it counts toward",
    responses=_NOT_FOUND,
)
def get_transaction(transaction_id: UUID, user: CurrentUserDep, db: UserDbDep) -> TransactionDetail:
    return service.get_transaction(db, user, transaction_id)


@router.patch(
    "/{transaction_id}",
    response_model=TransactionSaved,
    summary="Edit a transaction (recalculates budgets)",
    responses={
        **_NOT_FOUND,
        409: {**_problem, "description": "A scanned total must be changed through its items."},
    },
)
def update_transaction(
    transaction_id: UUID, body: TransactionUpdate, user: CurrentUserDep, db: UserDbDep
) -> TransactionSaved:
    return service.update_transaction(db, user, transaction_id, body)


@router.delete(
    "/{transaction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a transaction (recalculates budgets)",
    description=(
        "A scanned transaction also deletes its receipt; the receipt photo is removed from "
        "storage after the deletion is saved."
    ),
    responses=_NOT_FOUND,
)
def delete_transaction(
    transaction_id: UUID,
    user: CurrentUserDep,
    db: UserDbDep,
    receipt_storage: Annotated[Callable[[], ReceiptStorage], Depends(storage_provider)],
) -> Response:
    service.delete_transaction(db, user, transaction_id, receipt_storage)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
