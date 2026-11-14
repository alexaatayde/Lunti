"""Shopping list (SRS 3.1.7, AGENTS.md §9). One default "Grocery list" per user, created on
first use. Totals are computed here to the centavo (AGENTS.md §4.2), never on the phone.

Duplicates: an item that is already on the list and not yet bought is not added twice —
manual adds with the same name get 409; suggestion and recipe adds reuse the existing item.
"""

from collections.abc import Callable
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.core.errors import ApiError, not_found
from app.modules.analytics.products import normalize_name
from app.modules.expenses import budget_service, periods
from app.modules.replenishment.models import ShoppingList, ShoppingListItem
from app.modules.replenishment.schemas import ItemCreate, ItemUpdate, ListBudget
from app.modules.replenishment.schemas import ShoppingList as ListOut
from app.modules.replenishment.schemas import ShoppingListItem as ItemOut

DEFAULT_NAME = "Grocery list"


def line_estimate(quantity: Decimal, est_price: Decimal | None) -> Decimal | None:
    if est_price is None:
        return None
    return (quantity * est_price).quantize(periods.CENT, rounding=ROUND_HALF_UP)


def _item_out(item: ShoppingListItem) -> ItemOut:
    return ItemOut(
        id=item.id,
        name=item.name,
        quantity=item.quantity,
        unit=item.unit,
        est_price=item.est_price,
        line_estimate=line_estimate(item.quantity, item.est_price),
        is_purchased=item.is_purchased,
        source=item.source,  # type: ignore[arg-type]
        product_id=item.product_id,
        recipe_id=item.recipe_id,
        created_at=item.created_at,
    )


def default_list(db: Session, user: CurrentUser, *, lock: bool = False) -> ShoppingList:
    """The user's list (oldest), created if missing. `lock` serializes adds to it."""
    stmt = (
        select(ShoppingList)
        .where(ShoppingList.user_id == user.id)
        .order_by(ShoppingList.created_at, ShoppingList.id)
        .limit(1)
    )
    row = db.scalar(stmt.with_for_update() if lock else stmt)
    if row is None:
        # Serialize first-time creation per user, so two requests don't make two lists.
        db.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"shopping_list:{user.id}"))))
        row = db.scalar(stmt.with_for_update() if lock else stmt)
        if row is None:
            row = ShoppingList(user_id=user.id, name=DEFAULT_NAME)
            db.add(row)
            db.flush()
            db.refresh(row)
    return row


def _own_list(db: Session, user: CurrentUser, list_id: UUID, *, lock: bool = False) -> ShoppingList:
    stmt = select(ShoppingList).where(ShoppingList.id == list_id, ShoppingList.user_id == user.id)
    row = db.scalar(stmt.with_for_update() if lock else stmt)
    if row is None:
        raise not_found("Shopping list")
    return row


def _items(db: Session, list_id: UUID) -> list[ShoppingListItem]:
    return list(
        db.scalars(
            select(ShoppingListItem)
            .where(ShoppingListItem.shopping_list_id == list_id)
            .order_by(ShoppingListItem.created_at, ShoppingListItem.id)
        )
    )


def _food_budget(db: Session, user: CurrentUser, estimated: Decimal) -> ListBudget | None:
    """Active Groceries budget, else the active overall budget (shortest period first)."""
    statuses = [s for s in budget_service.list_status(db, user) if s.state == "active"]
    groceries = [s for s in statuses if s.budget.category and s.budget.category.icon == "groceries"]
    overall = [s for s in statuses if s.budget.category is None]
    pool = groceries or overall
    if not pool:
        return None
    chosen = min(pool, key=lambda s: (s.period_end, s.budget.created_at))
    after = chosen.remaining - estimated
    limit = chosen.budget.limit_amount
    pct = int((max(after, Decimal(0)) * 100 / limit).quantize(Decimal(1), ROUND_HALF_UP))
    return ListBudget(
        budget_id=chosen.budget.id,
        label=chosen.budget.label,
        period_type=chosen.budget.period_type,
        remaining=chosen.remaining,
        remaining_after=after,
        percent_left_after=pct,
    )


def to_out(db: Session, user: CurrentUser, row: ShoppingList) -> ListOut:
    items = [_item_out(i) for i in _items(db, row.id)]
    open_items = [i for i in items if not i.is_purchased]
    estimated = sum((i.line_estimate or Decimal(0) for i in open_items), Decimal("0.00"))
    picked = sum((i.line_estimate or Decimal(0) for i in items if i.is_purchased), Decimal("0.00"))
    return ListOut(
        id=row.id,
        name=row.name,
        items=items,
        open_count=len(open_items),
        purchased_count=len(items) - len(open_items),
        estimated_total=periods.money(estimated),
        picked_total=periods.money(picked),
        unpriced_count=sum(1 for i in open_items if i.est_price is None),
        budget=_food_budget(db, user, periods.money(estimated)),
    )


def list_lists(db: Session, user: CurrentUser) -> list[ListOut]:
    return [to_out(db, user, default_list(db, user))]


def _open_duplicate(
    db: Session, list_id: UUID, name: str, product_id: UUID | None
) -> ShoppingListItem | None:
    key = normalize_name(name)
    for item in _items(db, list_id):
        if item.is_purchased:
            continue
        if (product_id and item.product_id == product_id) or normalize_name(item.name) == key:
            return item
    return None


def add_item(db: Session, user: CurrentUser, list_id: UUID, data: ItemCreate) -> ItemOut:
    row = _own_list(db, user, list_id, lock=True)
    if _open_duplicate(db, row.id, data.name, None) is not None:
        raise ApiError(409, "conflict", f"{data.name} is already on your list.")
    item = ShoppingListItem(
        shopping_list_id=row.id,
        name=data.name,
        quantity=data.quantity,
        unit=data.unit or None,
        est_price=data.est_price,
        source="manual",
    )
    db.add(item)
    db.flush()
    db.refresh(item)
    return _item_out(item)


def add_suggested(
    db: Session,
    user: CurrentUser,
    *,
    name: str,
    product_id: UUID,
    quantity: Decimal,
    unit: str | None,
    est_price: Decimal | None,
) -> ItemOut:
    """For "Add to list": reuses an unbought item for the same product or name."""
    row = default_list(db, user, lock=True)
    existing = _open_duplicate(db, row.id, name, product_id)
    if existing is not None:
        return _item_out(existing)
    item = ShoppingListItem(
        shopping_list_id=row.id,
        name=name[:120],
        quantity=quantity,
        unit=unit,
        est_price=est_price,
        source="suggested",
        product_id=product_id,
    )
    db.add(item)
    db.flush()
    db.refresh(item)
    return _item_out(item)


def add_from_recipe(
    db: Session,
    user: CurrentUser,
    *,
    name: str,
    recipe_id: UUID,
    quantity: Decimal,
    unit: str | None,
    est_price: Decimal | None,
    covers: Callable[[str], bool] | None = None,
) -> tuple[ItemOut, bool]:
    """For "Add missing to list": the ingredient with the recipe's quantity and unit (source
    "recipe"). Returns (item, created). An unbought item with the same name, or one `covers`
    accepts by name, is returned unchanged (the user's own edits are kept)."""
    row = default_list(db, user, lock=True)
    existing = _open_duplicate(db, row.id, name, None)
    if existing is None and covers is not None:
        existing = next(
            (i for i in _items(db, row.id) if not i.is_purchased and covers(i.name)), None
        )
    if existing is not None:
        return _item_out(existing), False
    item = ShoppingListItem(
        shopping_list_id=row.id,
        name=name[:120],
        quantity=quantity,
        unit=unit or None,
        est_price=est_price,
        source="recipe",
        recipe_id=recipe_id,
    )
    db.add(item)
    db.flush()
    db.refresh(item)
    return _item_out(item), True


def _own_item(db: Session, user: CurrentUser, list_id: UUID, item_id: UUID) -> ShoppingListItem:
    row = _own_list(db, user, list_id, lock=True)
    item = db.scalar(
        select(ShoppingListItem).where(
            ShoppingListItem.id == item_id, ShoppingListItem.shopping_list_id == row.id
        )
    )
    if item is None:
        raise not_found("Item")
    return item


def update_item(
    db: Session, user: CurrentUser, list_id: UUID, item_id: UUID, data: ItemUpdate
) -> ItemOut:
    item = _own_item(db, user, list_id, item_id)
    fields = data.model_fields_set
    if (
        "name" in fields
        and data.name is not None
        and normalize_name(data.name) != normalize_name(item.name)
    ):
        other = _open_duplicate(db, list_id, data.name, None)
        if other is not None and other.id != item.id and not item.is_purchased:
            raise ApiError(409, "conflict", f"{data.name} is already on your list.")
        item.name = data.name
    if data.quantity is not None:
        item.quantity = data.quantity
    if "unit" in fields:
        item.unit = data.unit or None
    if "est_price" in fields:
        item.est_price = data.est_price
    if data.is_purchased is not None:
        item.is_purchased = data.is_purchased
    db.flush()
    db.refresh(item)
    return _item_out(item)


def delete_item(db: Session, user: CurrentUser, list_id: UUID, item_id: UUID) -> None:
    db.delete(_own_item(db, user, list_id, item_id))
    db.flush()


def open_summary(db: Session, user: CurrentUser) -> tuple[int, Decimal]:
    """(unbought items, their estimated total) for the shopping reminder."""
    out = to_out(db, user, default_list(db, user))
    return out.open_count, out.estimated_total
