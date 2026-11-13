"""Estimated pantry (AGENTS.md §7.5, SRS 3.1.8; decisions approved 2026-11-13).

- Confirmed receipt items in a Groceries-category transaction add their quantity. The row
  becomes an estimate again (confirmed_by_user = false), since it now includes a purchase.
- Units: a purchase in a compatible unit is converted into the row's unit (g→kg…) and added.
  A purchase whose unit can't be compared replaces an unconfirmed estimate (latest purchase
  wins) rather than adding numbers in different units; a confirmed amount is never
  overwritten that way (it stays as the user set it).
- No automatic decrease over time. Deleting a receipt transaction takes its quantities off
  unconfirmed rows (never below 0). The user's −/+ or edit sets the amount and confirms it.
- Expiry is only what the user sets (receipts carry no shelf life).
"""

from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.errors import invalid_field, not_found
from app.modules.analytics import products
from app.modules.expenses import periods
from app.modules.expenses.purchase_history import FoodLine
from app.modules.meals import units
from app.modules.meals.models import IngredientInventory
from app.modules.meals.schemas import PantryItem, PantryPage, PantryUpdate

ZERO = Decimal(0)


def _quantize(value: Decimal) -> Decimal:
    return max(value, ZERO).quantize(Decimal("0.001"))


def add_purchase(db: Session, user: CurrentUser, lines: list[FoodLine]) -> None:
    for line in lines:
        row = db.scalar(
            select(IngredientInventory)
            .where(
                IngredientInventory.user_id == user.id,
                IngredientInventory.product_id == line.product_id,
            )
            .with_for_update()
        )
        if row is None:
            db.add(
                IngredientInventory(
                    user_id=user.id,
                    product_id=line.product_id,
                    estimated_quantity=_quantize(line.quantity),
                    unit=line.unit,
                    confirmed_by_user=False,
                )
            )
            continue
        same_unit = (row.unit or None) == (line.unit or None)
        converted = (
            line.quantity if same_unit else units.convert(line.quantity, line.unit, row.unit)
        )
        if converted is None:
            if row.confirmed_by_user:
                continue  # never overwrite what the user confirmed with a mismatched unit
            row.estimated_quantity, row.unit = _quantize(line.quantity), line.unit
        else:
            row.estimated_quantity = _quantize(row.estimated_quantity + converted)
        row.confirmed_by_user = False
    db.flush()


def remove_purchase(db: Session, user: CurrentUser, lines: list[FoodLine]) -> None:
    """A receipt transaction was deleted: take its quantities off unconfirmed estimates."""
    for line in lines:
        row = db.scalar(
            select(IngredientInventory)
            .where(
                IngredientInventory.user_id == user.id,
                IngredientInventory.product_id == line.product_id,
            )
            .with_for_update()
        )
        if row is None or row.confirmed_by_user:
            continue
        same_unit = (row.unit or None) == (line.unit or None)
        converted = (
            line.quantity if same_unit else units.convert(line.quantity, line.unit, row.unit)
        )
        if converted is not None:
            row.estimated_quantity = _quantize(row.estimated_quantity - converted)
    db.flush()


def _days_left(expiry: date | None, today: date) -> int | None:
    return None if expiry is None else (expiry - today).days


def _to_out(row: IngredientInventory, name: str, today: date) -> PantryItem:
    days = _days_left(row.estimated_expiry, today)
    if row.estimated_quantity <= 0:
        state = "depleted"
    elif days is not None and days <= settings.pantry_expiring_days:
        state = "use_soon"
    else:
        state = "in_stock"
    return PantryItem(
        id=row.id,
        product_id=row.product_id,
        name=name,
        quantity=row.estimated_quantity,
        unit=row.unit,
        estimated_expiry=row.estimated_expiry,
        days_left=days,
        confirmed=row.confirmed_by_user,
        state=state,
        updated_at=row.updated_at,
    )


def rows(db: Session, user: CurrentUser) -> list[IngredientInventory]:
    return list(
        db.scalars(select(IngredientInventory).where(IngredientInventory.user_id == user.id))
    )


def named_items(db: Session, user: CurrentUser, today: date) -> list[PantryItem]:
    inventory = rows(db, user)
    names = products.refs(db, user, {r.product_id for r in inventory})
    items = [_to_out(r, names.get(r.product_id, ("Item", None))[0], today) for r in inventory]
    return sorted(items, key=lambda i: (i.state == "depleted", i.name.lower()))


def list_pantry(db: Session, user: CurrentUser) -> PantryPage:
    today = periods.local_today()
    items = named_items(db, user, today)
    use_first = sorted(
        (i for i in items if i.state == "use_soon"), key=lambda i: (i.days_left or 0, i.name)
    )
    return PantryPage(
        items=items,
        use_first=use_first,
        in_stock_count=sum(1 for i in items if i.state != "depleted"),
        use_soon_count=len(use_first),
        depleted_count=sum(1 for i in items if i.state == "depleted"),
        estimated_count=sum(1 for i in items if not i.confirmed),
    )


def update_item(db: Session, user: CurrentUser, item_id: UUID, data: PantryUpdate) -> PantryItem:
    row = db.scalar(
        select(IngredientInventory)
        .where(IngredientInventory.id == item_id, IngredientInventory.user_id == user.id)
        .with_for_update()
    )
    if row is None:
        raise not_found("Pantry item")
    fields = data.model_fields_set
    today = periods.local_today()
    if data.quantity is not None:
        row.estimated_quantity = data.quantity
    if "unit" in fields:
        row.unit = data.unit or None
    if "estimated_expiry" in fields:
        if data.estimated_expiry and data.estimated_expiry < today - timedelta(days=365):
            raise invalid_field("estimated_expiry", "Choose a recent or future date.", "range")
        row.estimated_expiry = data.estimated_expiry
    # Any amount the user sets, or an explicit confirm, makes it a confirmed amount.
    if data.quantity is not None or data.confirmed:
        row.confirmed_by_user = True
    db.flush()
    db.refresh(row)
    name = products.refs(db, user, {row.product_id}).get(row.product_id, ("Item", None))[0]
    return _to_out(row, name, today)


def expiring(db: Session, user: CurrentUser, today: date) -> list[PantryItem]:
    return [i for i in named_items(db, user, today) if i.state == "use_soon"]
