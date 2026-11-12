from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
)

from app.modules.expenses.schemas import (
    MAX_MONEY,
    CategoryRef,
    Merchant,
    Note,
    PositiveMoney,
    Transaction,
    TransactionSaved,
    _blank_to_none,
    _check_occurred_at,
)

ReceiptStatus = Literal["processing", "draft", "failed", "confirmed"]
FailureReason = Literal["unreadable", "no_amounts"]
FlagField = Literal["merchant", "occurred_at", "total", "items"]

Money = Annotated[
    Decimal, Field(ge=0, le=MAX_MONEY, max_digits=12, decimal_places=2, allow_inf_nan=False)
]
# NUMERIC(10,3)
Quantity = Annotated[
    Decimal,
    Field(gt=0, le=Decimal("9999999.999"), max_digits=10, decimal_places=3, allow_inf_nan=False),
]
ItemName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Unit = Annotated[str, StringConstraints(strip_whitespace=True, max_length=16)]

MAX_ITEMS = 200


class Confidence(BaseModel):
    """Whole percents (0–100), shown as "Store 99% · Items 94% · Total 98%"."""

    store: int
    items: int
    total: int


class ReviewFlag(BaseModel):
    """A field the user should check before saving (low confidence, missing, ambiguous)."""

    field: FlagField
    code: str
    message: str


class DraftItem(BaseModel):
    name: str
    quantity: Decimal
    unit: str | None
    unit_price: Decimal
    discount: Decimal
    line_total: Decimal
    needs_review: bool


class ReceiptDraft(BaseModel):
    """What OCR found. Nothing here is saved as a transaction until it is confirmed."""

    merchant: str | None
    occurred_at: datetime | None
    total: Decimal | None
    subtotal: Decimal | None
    # Receipt-level discount (senior citizen / PWD / promo), not counted in item discounts.
    discount: Decimal
    # VAT printed on the receipt (12 %, already included in the prices; informational).
    vat: Decimal | None
    items: list[DraftItem]
    # Item line totals minus `discount`; equals `total` when the receipt reconciles.
    items_total: Decimal


class Receipt(BaseModel):
    id: UUID
    status: ReceiptStatus
    created_at: datetime
    # "google_vision", or "fixture" for simulated development results.
    ocr_engine: str | None
    simulated: bool
    failure_reason: FailureReason | None
    draft: ReceiptDraft | None
    confidence: Confidence | None
    flags: list[ReviewFlag]
    suggested_category: CategoryRef | None
    # Same amount on the same day already recorded: probably scanned or entered before.
    possible_duplicate: Transaction | None
    transaction_id: UUID | None
    # Short-lived signed URL of the private image (null in local development storage).
    image_url: str | None


class ConfirmItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ItemName
    quantity: Quantity = Decimal("1")
    unit: Unit | None = None
    unit_price: Money
    discount: Money = Decimal("0")

    _blank = field_validator("unit")(_blank_to_none)


class ReceiptConfirm(BaseModel):
    """The user-checked receipt. Line totals are recomputed on the server."""

    model_config = ConfigDict(extra="forbid")

    category_id: UUID
    occurred_at: AwareDatetime
    merchant: Merchant | None = None
    note: Note | None = None
    total: PositiveMoney
    discount: Money = Decimal("0")
    items: list[ConfirmItem] = Field(default_factory=list, max_length=MAX_ITEMS)

    _blank = field_validator("merchant", "note")(_blank_to_none)
    _date = field_validator("occurred_at")(_check_occurred_at)


class ReceiptConfirmed(TransactionSaved):
    # True when this receipt had already been saved (a retried request): nothing new was
    # written and no budget alert is repeated.
    already_confirmed: bool
