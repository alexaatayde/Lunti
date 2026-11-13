from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.modules.replenishment.schemas import ShoppingListItem

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Unit = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]
Quantity = Annotated[
    Decimal, Field(ge=0, le=Decimal("9999999.999"), max_digits=10, decimal_places=3)
]
PositiveQuantity = Annotated[
    Decimal, Field(gt=0, le=Decimal("9999999.999"), max_digits=10, decimal_places=3)
]

# ---------- pantry ----------


class PantryItem(BaseModel):
    id: UUID
    product_id: UUID
    name: str
    quantity: Decimal = Field(description="Estimated unless `confirmed`.")
    unit: str | None
    estimated_expiry: date | None = Field(description="Only ever set by the user.")
    days_left: int | None
    confirmed: bool = Field(description="False = an estimate from purchases.")
    state: Literal["in_stock", "use_soon", "depleted"]
    updated_at: datetime


class PantryPage(BaseModel):
    items: list[PantryItem]
    use_first: list[PantryItem]
    in_stock_count: int
    use_soon_count: int
    depleted_count: int
    estimated_count: int


class PantryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    quantity: Quantity | None = None
    unit: Unit | None = None
    estimated_expiry: date | None = None
    confirmed: bool | None = Field(None, description="true = confirm the amount as it is.")

    @model_validator(mode="after")
    def _has_changes(self) -> "PantryUpdate":
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change.")
        if "quantity" in self.model_fields_set and self.quantity is None:
            raise ValueError("quantity can't be null.")
        return self


# ---------- recipes ----------


class IngredientOut(BaseModel):
    name: str
    quantity: Decimal
    unit: str | None
    status: Literal["available", "check_amount", "missing"]
    pantry_item_name: str | None = Field(description="The pantry item it matched.")
    est_price: Decimal | None = Field(
        description="Missing only: what you last paid for one purchase of it (null = unknown)."
    )


class RecipeSummary(BaseModel):
    id: UUID
    name: str
    servings: int
    prep_time_minutes: int
    match_pct: int = Field(description="Available ÷ required ingredients, whole percent.")
    available_count: int
    check_amount_count: int
    total_count: int
    missing: list[IngredientOut]
    missing_cost: Decimal = Field(
        description="Sum of KNOWN prices of missing ingredients; see missing_unpriced_count."
    )
    missing_unpriced_count: int


class RecipeDetail(RecipeSummary):
    ingredients: list[IngredientOut]


class Recommendations(BaseModel):
    items: list[RecipeSummary]
    budget_label: str | None
    budget_remaining: Decimal | None
    over_budget_count: int = Field(
        description="Recipes left out because the KNOWN estimated cost of their missing "
        "ingredients is more than the food budget has left (unknown prices aren't counted)."
    )


class AddMissingResult(BaseModel):
    added: list[ShoppingListItem]
    already_on_list: list[str]


class IngredientIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    quantity: PositiveQuantity
    unit: Unit | None = None


class RecipeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    servings: Annotated[int, Field(gt=0, le=100)]
    prep_time_minutes: Annotated[int, Field(ge=0, le=1440)]
    ingredients: Annotated[list[IngredientIn], Field(min_length=1, max_length=40)]
