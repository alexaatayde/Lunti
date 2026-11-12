"""`/receipts` (AGENTS.md §7.1, §9; SRS 3.1.2)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status

from app.core.auth import CurrentUserDep
from app.core.config import settings
from app.core.db import UserDbDep
from app.core.errors import PROBLEM_JSON, PROBLEM_RESPONSES, Problem
from app.modules.receipts import service
from app.modules.receipts.ocr import OcrEngine, get_ocr
from app.modules.receipts.schemas import Receipt, ReceiptConfirm, ReceiptConfirmed
from app.modules.receipts.storage import ReceiptStorage, get_storage

router = APIRouter(prefix="/receipts", tags=["receipts"], responses=PROBLEM_RESPONSES)

_problem = {"model": Problem, "content": {PROBLEM_JSON: {}}}
_NOT_FOUND = {404: {**_problem, "description": "Receipt not found."}}

OcrDep = Annotated[OcrEngine, Depends(get_ocr)]
StorageDep = Annotated[ReceiptStorage, Depends(get_storage)]


@router.post(
    "",
    response_model=Receipt,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a receipt photo and read it (returns a draft; nothing is saved as a "
    "transaction)",
    responses={
        200: {"model": Receipt, "description": "This client_id was uploaded before."},
        409: {**_problem, "description": "The client_id is already used."},
    },
)
def upload_receipt(
    response: Response,
    user: CurrentUserDep,
    db: UserDbDep,
    ocr: OcrDep,
    storage: StorageDep,
    image: Annotated[UploadFile, File(description="JPEG, PNG or WebP photo of the receipt.")],
    client_id: Annotated[
        UUID, Form(description="A new UUID per photo; resending it returns the same receipt.")
    ],
) -> Receipt:
    data = image.file.read(settings.receipt_max_bytes + 1)
    receipt, created = service.upload_receipt(
        db, user, client_id=client_id, data=data, ocr=ocr, storage=storage
    )
    if not created:
        response.status_code = status.HTTP_200_OK
    return receipt


@router.get(
    "/{receipt_id}",
    response_model=Receipt,
    summary="A receipt with its draft, confidence and review flags",
    responses=_NOT_FOUND,
)
def get_receipt(
    receipt_id: UUID, user: CurrentUserDep, db: UserDbDep, storage: StorageDep
) -> Receipt:
    return service.get_receipt(db, user, receipt_id, storage)


@router.post(
    "/{receipt_id}/confirm",
    response_model=ReceiptConfirmed,
    summary="Save the checked receipt as a transaction (recalculates budgets; idempotent)",
    responses={
        **_NOT_FOUND,
        409: {**_problem, "description": "The receipt failed to read or was already deleted."},
    },
)
def confirm_receipt(
    receipt_id: UUID, body: ReceiptConfirm, user: CurrentUserDep, db: UserDbDep
) -> ReceiptConfirmed:
    return service.confirm_receipt(db, user, receipt_id, body)


@router.delete(
    "/{receipt_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Discard an unconfirmed receipt and its photo",
    responses={**_NOT_FOUND, 409: {**_problem, "description": "The receipt was saved."}},
)
def discard_receipt(
    receipt_id: UUID, user: CurrentUserDep, db: UserDbDep, storage: StorageDep
) -> Response:
    service.discard_receipt(db, user, receipt_id, storage)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
