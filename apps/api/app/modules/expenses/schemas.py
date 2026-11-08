from datetime import UTC, date, datetime, timedelta
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
    model_validator,
)

CategoryName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
CategoryIcon = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,32}$")]


class Category(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    icon: str | None
    is_default: bool


class CategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CategoryName
    icon: CategoryIcon | None = None


class CategoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CategoryName | None = None
    icon: CategoryIcon | None = None

    @model_validator(mode="after")
    def _has_changes(self) -> "CategoryUpdate":
        if not self.model_fields_set:
            raise ValueError("Send at least one of: name, icon.")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name can't be null.")
        return self


# ---------- money ----------

# NUMERIC(12,2): up to 9,999,999,999.99. Accepts "12.50" or 12.5; always returned as a string.
MAX_MONEY = Decimal("9999999999.99")
PositiveMoney = Annotated[
    Decimal, Field(gt=0, le=MAX_MONEY, max_digits=12, decimal_places=2, allow_inf_nan=False)
]
Merchant = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
PeriodType = Literal["daily", "weekly", "monthly", "custom"]
Level = Literal["none", "near", "exceeded"]

# Expenses can't be dated before this or more than a day ahead (device clock drift).
EARLIEST_EXPENSE = datetime(2000, 1, 1, tzinfo=UTC)
MAX_FUTURE = timedelta(days=1)


def _blank_to_none(value: str | None) -> str | None:
    return value or None


def _check_occurred_at(value: datetime) -> datetime:
    if value < EARLIEST_EXPENSE:
        raise ValueError("Date is too far in the past.")
    if value > datetime.now(UTC) + MAX_FUTURE:
        raise ValueError("Date can't be in the future.")
    return value


class CategoryRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    icon: str | None


# ---------- transactions ----------


class LineItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    quantity: Decimal
    unit: str | None
    unit_price: Decimal
    discount: Decimal
    tax: Decimal
    line_total: Decimal


class Transaction(BaseModel):
    id: UUID
    amount: Decimal
    occurred_at: datetime
    merchant: str | None
    note: str | None
    source: Literal["manual", "receipt"]
    receipt_id: UUID | None
    category: CategoryRef
    item_count: int
    created_at: datetime
    updated_at: datetime


class BudgetImpact(BaseModel):
    """A budget this transaction counts toward, for the period that contains it."""

    budget_id: UUID
    label: str
    period_type: PeriodType
    period_start: date
    period_end: date
    limit_amount: Decimal
    spent: Decimal
    remaining: Decimal
    # What `remaining` would be if this transaction were deleted (delete dialog).
    remaining_without_this: Decimal
    percent_used: int
    level: Level


class TransactionDetail(Transaction):
    items: list[LineItem]
    budgets: list[BudgetImpact]


class BudgetAlert(BaseModel):
    """A budget whose level just rose because of this change (near limit / exceeded)."""

    budget_id: UUID
    label: str
    level: Literal["near", "exceeded"]
    spent: Decimal
    limit_amount: Decimal
    remaining: Decimal


class TransactionSaved(Transaction):
    budget_alerts: list[BudgetAlert]


class TransactionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: PositiveMoney
    category_id: UUID
    occurred_at: AwareDatetime
    merchant: Merchant | None = None
    note: Note | None = None

    _blank = field_validator("merchant", "note")(_blank_to_none)
    _date = field_validator("occurred_at")(_check_occurred_at)


class TransactionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: PositiveMoney | None = None
    category_id: UUID | None = None
    occurred_at: AwareDatetime | None = None
    merchant: Merchant | None = None
    note: Note | None = None

    _blank = field_validator("merchant", "note")(_blank_to_none)

    @field_validator("occurred_at")
    @classmethod
    def _date(cls, value: datetime | None) -> datetime | None:
        return None if value is None else _check_occurred_at(value)

    @model_validator(mode="after")
    def _has_changes(self) -> "TransactionUpdate":
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change.")
        for name in ("amount", "category_id", "occurred_at"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} can't be null.")
        return self


class TransactionPage(BaseModel):
    items: list[Transaction]
    # Pass as `cursor` to get the next page; null on the last page.
    next_cursor: str | None


class CategoryTotal(BaseModel):
    category: CategoryRef
    total: Decimal
    count: int
    share_pct: int = Field(description="Whole percent of the overall total (rounded half up).")


class TransactionSummary(BaseModel):
    """Totals for the same filters as GET /transactions (all pages)."""

    total: Decimal
    count: int
    receipt_count: int
    manual_count: int
    by_category: list[CategoryTotal]


# ---------- budgets ----------


class Budget(BaseModel):
    id: UUID
    category: CategoryRef | None  # null = overall (all categories)
    label: str
    period_type: PeriodType
    start_date: date
    end_date: date | None
    limit_amount: Decimal
    alerts_enabled: bool
    created_at: datetime
    updated_at: datetime


class BudgetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: UUID | None = None
    period_type: PeriodType
    # Defaults to today (app time zone). Required with an end date for custom budgets.
    start_date: date | None = None
    end_date: date | None = None
    limit_amount: PositiveMoney
    alerts_enabled: bool = True


class BudgetUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: UUID | None = None
    period_type: PeriodType | None = None
    start_date: date | None = None
    end_date: date | None = None
    limit_amount: PositiveMoney | None = None
    alerts_enabled: bool | None = None

    @model_validator(mode="after")
    def _has_changes(self) -> "BudgetUpdate":
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change.")
        for name in ("period_type", "start_date", "limit_amount", "alerts_enabled"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} can't be null.")
        return self


class BudgetStatus(BaseModel):
    budget: Budget
    state: Literal["active", "upcoming", "ended"]
    period_start: date
    period_end: date
    spent: Decimal
    remaining: Decimal
    percent_used: int
    level: Level
    days_left: int
    safe_daily_amount: Decimal | None
    on_pace: bool | None
