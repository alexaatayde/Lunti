"""Recipe recommendations (AGENTS.md §7.5, SRS 3.1.9). Matching rules: meals/matching.py.

- Catalog: shared, seeded (migration 0003) and extended by admins only.
- Missing ingredient cost: what the user last paid for one purchase of a matching product;
  unknown when they never bought one (the catalog has no prices). Never invented, and an
  unknown price is never counted as ₱0 (missing_unpriced_count says how many).
- Budget: based on known estimated costs only (see below).
- Ranking: match % (high first), fewer missing, shorter total time (prep + cook), name.
- Budget: when an active Groceries (else overall) budget exists, recipes whose known missing
  cost is more than what's left are left out (the response says how many).
- "Add missing to list" (Phase 8C): one list item per missing ingredient (source "recipe"),
  with the quantity and unit the recipe needs (the full amount: pantry amounts are estimates).
  Its price per unit is the last price paid only when that purchase was in the same unit;
  otherwise it is left unknown rather than guessed. An unbought list item that already covers
  the ingredient (same name, or a product name that matches it, e.g. "Datu Puti soy sauce"
  for "soy sauce") is kept exactly as the user left it and nothing is added.
"""

from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.errors import not_found
from app.modules.analytics.models import Product
from app.modules.expenses import budget_service, periods, purchase_history
from app.modules.meals import matching, pantry, units
from app.modules.meals.models import Recipe, RecipeIngredient
from app.modules.meals.schemas import (
    AddMissingResult,
    IngredientOut,
    RecipeCreate,
    RecipeDetail,
    RecipeSummary,
    Recommendations,
)
from app.modules.replenishment import shopping


def _catalog(
    db: Session, recipe_id: UUID | None = None
) -> list[tuple[Recipe, list[RecipeIngredient]]]:
    stmt = select(Recipe).order_by(Recipe.name, Recipe.id)
    if recipe_id is not None:
        stmt = stmt.where(Recipe.id == recipe_id)
    recipes = list(db.scalars(stmt))
    by_recipe: dict[UUID, list[RecipeIngredient]] = {r.id: [] for r in recipes}
    if recipes:
        for ing in db.scalars(
            select(RecipeIngredient)
            .where(RecipeIngredient.recipe_id.in_(list(by_recipe)))
            .order_by(RecipeIngredient.created_at, RecipeIngredient.id)
        ):
            by_recipe[ing.recipe_id].append(ing)
    return [(r, by_recipe[r.id]) for r in recipes]


class _Context:
    """Pantry and price data for one user, loaded once per request."""

    def __init__(self, db: Session, user: CurrentUser) -> None:
        today = periods.local_today()
        self.catalog = frozenset(db.scalars(select(RecipeIngredient.name).distinct()))
        self.pantry = [
            matching.PantryItem(i.product_id, i.name, i.quantity, i.unit, i.confirmed)
            for i in pantry.named_items(db, user, today)
        ]
        names = db.execute(
            select(Product.id, Product.name)
            .where(Product.user_id == user.id)
            .order_by(Product.name)
        ).all()
        self.products = names
        self.purchases = purchase_history.last_unit_purchases(db, user, {i for i, _ in names})

    def _last_purchase(self, ingredient: str) -> tuple[Decimal, str | None] | None:
        for product_id, name in self.products:
            if product_id in self.purchases and self.matches(ingredient, name):
                return self.purchases[product_id]
        return None

    def matches(self, ingredient: str, name: str) -> bool:
        return matching.name_matches(ingredient, name) and not matching.more_specific_match(
            ingredient, name, self.catalog
        )

    def price_for(self, ingredient: str) -> Decimal | None:
        last = self._last_purchase(ingredient)
        return last[0] if last else None

    def unit_price_for(self, ingredient: str, unit: str | None) -> Decimal | None:
        """Last price per `unit`, only when that purchase was in the same unit."""
        last = self._last_purchase(ingredient)
        return last[0] if last and units.same_unit(last[1], unit) else None


def _evaluate(
    recipe: Recipe, ingredients: list[RecipeIngredient], ctx: _Context
) -> tuple[RecipeSummary, list[IngredientOut]]:
    outs: list[IngredientOut] = []
    statuses = []
    for ing in ingredients:
        status = matching.ingredient_status(
            matching.Need(ing.name, ing.quantity_required, ing.unit), ctx.pantry, ctx.catalog
        )
        statuses.append(status)
        have = status.pantry
        outs.append(
            IngredientOut(
                name=ing.name,
                quantity=ing.quantity_required,
                unit=ing.unit,
                status=status.status,  # type: ignore[arg-type]
                pantry_item_name=have.name if have else None,
                have_quantity=have.quantity if have else None,
                have_unit=have.unit if have else None,
                have_confirmed=have.confirmed if have else None,
                not_enough=status.status == "missing" and have is not None,
                est_price=ctx.price_for(ing.name) if status.status == "missing" else None,
            )
        )
    missing = [o for o in outs if o.status == "missing"]
    summary = RecipeSummary(
        id=recipe.id,
        name=recipe.name,
        servings=recipe.servings,
        prep_time_minutes=recipe.prep_time_minutes,
        cook_time_minutes=recipe.cook_time_minutes,
        total_time_minutes=recipe.prep_time_minutes + recipe.cook_time_minutes,
        match_pct=matching.match_pct(statuses),
        available_count=sum(1 for o in outs if o.status == "available"),
        check_amount_count=sum(1 for o in outs if o.status == "check_amount"),
        total_count=len(outs),
        missing=missing,
        missing_cost=periods.money(sum((m.est_price or Decimal(0) for m in missing), Decimal(0))),
        missing_unpriced_count=sum(1 for m in missing if m.est_price is None),
    )
    return summary, outs


def _food_budget(db: Session, user: CurrentUser) -> tuple[str, Decimal] | None:
    statuses = [s for s in budget_service.list_status(db, user) if s.state == "active"]
    groceries = [s for s in statuses if s.budget.category and s.budget.category.icon == "groceries"]
    pool = groceries or [s for s in statuses if s.budget.category is None]
    if not pool:
        return None
    chosen = min(pool, key=lambda s: (s.period_end, s.budget.created_at))
    return chosen.budget.label, chosen.remaining


def recommendations(db: Session, user: CurrentUser) -> Recommendations:
    ctx = _Context(db, user)
    budget = _food_budget(db, user)
    ranked = sorted(
        (_evaluate(r, ings, ctx)[0] for r, ings in _catalog(db)),
        key=lambda s: (-s.match_pct, len(s.missing), s.total_time_minutes, s.name.lower()),
    )
    ranked = [s for s in ranked if s.match_pct > 0]
    over = 0
    if budget is not None:
        within = [s for s in ranked if s.missing_cost <= max(budget[1], Decimal(0))]
        over = len(ranked) - len(within)
        ranked = within
    return Recommendations(
        items=ranked[: settings.recommendations_limit],
        budget_label=budget[0] if budget else None,
        budget_remaining=budget[1] if budget else None,
        over_budget_count=over,
    )


def best_match(db: Session, user: CurrentUser) -> RecipeSummary | None:
    items = recommendations(db, user).items
    return items[0] if items else None


def _detail(db: Session, user: CurrentUser, recipe_id: UUID) -> tuple[RecipeDetail, _Context]:
    found = _catalog(db, recipe_id)
    if not found:
        raise not_found("Recipe")
    recipe, ingredients = found[0]
    ctx = _Context(db, user)
    summary, outs = _evaluate(recipe, ingredients, ctx)
    detail = RecipeDetail(
        **summary.model_dump(),
        ingredients=outs,
        steps=list(recipe.steps),
        staples=list(recipe.staples),
    )
    return detail, ctx


def get_recipe(db: Session, user: CurrentUser, recipe_id: UUID) -> RecipeDetail:
    return _detail(db, user, recipe_id)[0]


def add_missing(db: Session, user: CurrentUser, recipe_id: UUID) -> AddMissingResult:
    detail, ctx = _detail(db, user, recipe_id)
    added, existing = [], []
    for ing in detail.missing:
        item, created = shopping.add_from_recipe(
            db,
            user,
            name=ing.name[:1].upper() + ing.name[1:],
            recipe_id=recipe_id,
            quantity=ing.quantity,
            unit=ing.unit,
            est_price=ctx.unit_price_for(ing.name, ing.unit),
            covers=lambda item_name, ingredient=ing.name: ctx.matches(ingredient, item_name),
        )
        (added if created else existing).append(item if created else item.name)
    return AddMissingResult(added=added, already_on_list=existing)


def create_recipe(db: Session, data: RecipeCreate) -> UUID:
    """Admin only (the router checks the role and passes a non-user session)."""
    recipe = Recipe(
        name=data.name,
        servings=data.servings,
        prep_time_minutes=data.prep_time_minutes,
        cook_time_minutes=data.cook_time_minutes,
        steps=list(data.steps),
        staples=list(data.staples),
    )
    db.add(recipe)
    db.flush()
    db.add_all(
        RecipeIngredient(
            recipe_id=recipe.id, name=i.name, quantity_required=i.quantity, unit=i.unit or None
        )
        for i in data.ingredients
    )
    db.flush()
    return recipe.id


def catalog_size(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(Recipe)) or 0
