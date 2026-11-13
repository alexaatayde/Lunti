from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

ItemName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Unit = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]
Quantity = Annotated[
    Decimal, Field(gt=0, le=Decimal("9999999.999"), max_digits=10, decimal_places=3)
]
Price = Annotated[
    Decimal, Field(ge=0, le=Decimal("9999999999.99"), max_digits=12, decimal_places=2)
]
ItemSource = Literal["manual", "suggested", "recipe"]
FeedbackAction = Literal[
    "add_to_list", "still_have", "bought_elsewhere", "dont_remind", "dismiss", "modify"
]


# ---------- shopping lists ----------


class ShoppingListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    quantity: Decimal
    unit: str | None
    est_price: Decimal | None = Field(description="Estimated price per unit.")
    line_estimate: Decimal | None = Field(description="quantity × est_price, to the centavo.")
    is_purchased: bool
    source: ItemSource
    product_id: UUID | None
    recipe_id: UUID | None
    created_at: datetime


class ListBudget(BaseModel):
    """The food budget the list is checked against (Groceries budget, else overall)."""

    budget_id: UUID
    label: str
    period_type: str
    remaining: Decimal
    remaining_after: Decimal = Field(description="remaining − estimated_total (may be < 0).")
    percent_left_after: int = Field(description="remaining_after as whole % of the limit.")


class ShoppingList(BaseModel):
    id: UUID
    name: str
    items: list[ShoppingListItem]
    open_count: int
    purchased_count: int
    estimated_total: Decimal = Field(description="Sum of line estimates of unbought items.")
    picked_total: Decimal = Field(description="Sum of line estimates of bought items.")
    unpriced_count: int = Field(description="Unbought items without an estimated price.")
    budget: ListBudget | None


class ItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ItemName
    quantity: Quantity = Decimal(1)
    unit: Unit | None = None
    est_price: Price | None = None


class ItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ItemName | None = None
    quantity: Quantity | None = None
    unit: Unit | None = None
    est_price: Price | None = None
    is_purchased: bool | None = None

    @model_validator(mode="after")
    def _has_changes(self) -> "ItemUpdate":
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change.")
        for name in ("name", "quantity", "is_purchased"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} can't be null.")
        return self


# ---------- suggestions ----------


class ProductRef(BaseModel):
    id: UUID
    name: str
    unit: str | None


class Suggestion(BaseModel):
    id: UUID
    product: ProductRef
    predicted_date: date
    days_until: int = Field(description="predicted_date − today (negative = overdue).")
    avg_interval_days: Decimal | None
    confidence: Decimal = Field(
        description="Heuristic consistency score of the pattern (not a probability)."
    )
    status: Literal["pending", "added", "dismissed", "modified"]
    quantity: Decimal | None
    last_purchased_at: datetime | None


class SuggestionFeedback(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: FeedbackAction
    # Only for "modify": the new reminder date and/or quantity.
    predicted_date: date | None = None
    quantity: Quantity | None = None

    @model_validator(mode="after")
    def _modify_needs_a_change(self) -> "SuggestionFeedback":
        if self.action == "modify" and self.predicted_date is None and self.quantity is None:
            raise ValueError("Modify needs a new date or quantity.")
        if self.action != "modify" and (self.predicted_date or self.quantity):
            raise ValueError("Only modify takes a date or quantity.")
        return self


class MutedProduct(BaseModel):
    product: ProductRef
    muted_at: datetime


class FeedbackResult(BaseModel):
    suggestion: Suggestion
    shopping_item: ShoppingListItem | None = Field(
        description="The list item for add_to_list (an existing one if it was already there)."
    )
