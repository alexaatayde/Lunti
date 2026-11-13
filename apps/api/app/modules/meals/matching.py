"""Recipe matching (AGENTS.md §7.5). Pure: no database.

- An ingredient matches a pantry product when every word of the ingredient's normalized name
  is in the product's name (plurals ignored): "eggs" matches "Eggs large", "soy sauce"
  matches "Datu Puti soy sauce 1L".
- More specific catalog ingredients win: a product that matches a longer catalog ingredient
  containing these words ("fish sauce", "tomato sauce", "corned beef") is not used for the
  shorter one ("fish", "tomato", "beef"). Driven by the catalog's own names, so new recipes
  need no code change.
- An ingredient is available when a matching pantry item has quantity > 0 and either enough
  of it in a compatible unit, or a unit that can't be compared ("check amount"; counted as
  available, never as a known amount). Too little in a compatible unit = missing.
- match = available ÷ total required ingredients, as a whole percent (rounded down).
"""

from dataclasses import dataclass
from decimal import Decimal

from app.modules.analytics.products import normalize_name
from app.modules.meals import units


def _stem(word: str) -> str:
    if len(word) > 3 and word.endswith("es") and word[:-2].endswith(("o", "ch", "sh", "s")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def words(name: str) -> frozenset[str]:
    return frozenset(_stem(w) for w in normalize_name(name).split())


def name_matches(ingredient: str, product: str) -> bool:
    need = words(ingredient)
    return bool(need) and need <= words(product)


@dataclass(frozen=True)
class PantryItem:
    product_id: object
    name: str
    quantity: Decimal
    unit: str | None


@dataclass(frozen=True)
class Need:
    name: str
    quantity: Decimal
    unit: str | None


@dataclass(frozen=True)
class IngredientStatus:
    need: Need
    status: str  # "available" | "check_amount" | "missing"
    pantry: PantryItem | None


RANK = {"enough": 0, "unknown": 1, "short": 2}


def more_specific_match(ingredient: str, product: str, catalog: frozenset[str]) -> bool:
    """The product is really a more specific catalog ingredient (e.g. fish sauce, not fish)."""
    need, have = words(ingredient), words(product)
    return any(need < words(other) <= have for other in catalog)


def ingredient_status(
    need: Need, pantry: list[PantryItem], catalog: frozenset[str] = frozenset()
) -> IngredientStatus:
    candidates = [
        p
        for p in pantry
        if p.quantity > 0
        and name_matches(need.name, p.name)
        and not more_specific_match(need.name, p.name, catalog)
    ]
    if not candidates:
        return IngredientStatus(need, "missing", None)
    scored = sorted(
        candidates,
        key=lambda p: (RANK[units.compare(p.quantity, p.unit, need.quantity, need.unit)], p.name),
    )
    best = scored[0]
    amount = units.compare(best.quantity, best.unit, need.quantity, need.unit)
    status = {"enough": "available", "unknown": "check_amount", "short": "missing"}[amount]
    return IngredientStatus(need, status, best)


def match_pct(statuses: list[IngredientStatus]) -> int:
    if not statuses:
        return 0
    available = sum(1 for s in statuses if s.status != "missing")
    return available * 100 // len(statuses)
