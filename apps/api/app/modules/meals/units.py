"""Units for pantry and recipe matching (AGENTS.md §7.5, approved 2026-11-13).

Conversions only within a family: mass (g, kg), volume (ml, l, tsp, tbsp, cup). Count-like
units (pcs, pack, tray, can, bottle, …) only equal themselves. Anything else is unknown, and
an unknown or incompatible unit is never guessed: the caller flags it "check amount".
"""

from decimal import Decimal
from typing import Literal

Amount = Literal["enough", "short", "unknown"]

_UNITS: dict[str, tuple[str, Decimal]] = {
    "g": ("mass", Decimal(1)),
    "kg": ("mass", Decimal(1000)),
    "ml": ("volume", Decimal(1)),
    "l": ("volume", Decimal(1000)),
    "tsp": ("volume", Decimal(5)),
    "tbsp": ("volume", Decimal(15)),
    "cup": ("volume", Decimal(240)),
}
_ALIASES = {
    "gram": "g", "grams": "g", "gm": "g", "kilo": "kg", "kilos": "kg", "kgs": "kg",
    "liter": "l", "liters": "l", "litre": "l", "litres": "l", "ltr": "l",
    "milliliter": "ml", "milliliters": "ml", "mls": "ml",
    "teaspoon": "tsp", "teaspoons": "tsp", "tablespoon": "tbsp", "tablespoons": "tbsp",
    "cups": "cup",
    "pc": "pcs", "piece": "pcs", "pieces": "pcs", "ea": "pcs", "each": "pcs",
    "packs": "pack", "pk": "pack", "trays": "tray", "cans": "can", "bottles": "bottle",
    "bags": "bag", "bunches": "bunch", "heads": "head", "cloves": "clove",
}  # fmt: skip
_COUNTS = {"pcs", "pack", "tray", "can", "bottle", "bag", "bunch", "head", "clove", "dozen"}


def canonical(unit: str | None) -> tuple[str, Decimal] | None:
    """(family, factor to the family's base unit), or None when unknown."""
    if not unit:
        return None
    key = unit.strip().lower().rstrip(".")
    key = _ALIASES.get(key, key)
    if key in _UNITS:
        return _UNITS[key]
    if key in _COUNTS:
        return (f"count:{key}", Decimal(1))
    return None


def convert(quantity: Decimal, unit: str | None, to_unit: str | None) -> Decimal | None:
    """quantity in `unit` expressed in `to_unit`; None if not convertible."""
    a, b = canonical(unit), canonical(to_unit)
    if a is None or b is None or a[0] != b[0]:
        return None
    return quantity * a[1] / b[1]


def same_unit(a: str | None, b: str | None) -> bool:
    """Both known and the same unit (aliases count: "kgs" = "kg"); "g" vs "kg" is not."""
    ca, cb = canonical(a), canonical(b)
    return ca is not None and ca == cb


def compare(have: Decimal, have_unit: str | None, need: Decimal, need_unit: str | None) -> Amount:
    converted = convert(have, have_unit, need_unit)
    if converted is None:
        return "unknown"
    return "enough" if converted >= need else "short"
