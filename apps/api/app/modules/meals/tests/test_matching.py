"""Units and recipe matching (AGENTS.md §7.5, decisions of 2026-11-13): pure functions."""

from decimal import Decimal as D

import pytest

from app.modules.meals import matching, units
from app.modules.meals.matching import Need, PantryItem


@pytest.mark.parametrize(
    ("have", "have_unit", "need", "need_unit", "result"),
    [("1", "kg", "500", "g", "enough"), ("0.4", "kg", "500", "g", "short"),
     ("1", "L", "120", "ml", "enough"), ("100", "ml", "8", "tbsp", "short"),
     ("12", "pcs", "2", "pc", "enough"), ("1", "tray", "2", "pcs", "unknown"),
     ("1", None, "2", "pcs", "unknown"), ("1", "kg", "2", "pcs", "unknown"),
     ("3", "Pieces", "2", "pcs", "enough"), ("1", "bottle", "120", "ml", "unknown")],
)  # fmt: skip
def test_unit_compare(have: str, have_unit, need: str, need_unit, result: str) -> None:  # noqa: ANN001
    assert units.compare(D(have), have_unit, D(need), need_unit) == result


def test_convert_only_within_a_family() -> None:
    assert units.convert(D("1.5"), "kg", "g") == D("1500")
    assert units.convert(D("2"), "tbsp", "ml") == D("30")
    assert units.convert(D("1"), "kg", "ml") is None
    assert units.canonical("bunches") == ("count:bunch", D(1))
    assert units.canonical("handful") is None


@pytest.mark.parametrize(
    ("ingredient", "product", "ok"),
    [("eggs", "Eggs large", True), ("eggs", "EGGS (12)", True), ("egg", "Eggs 1 tray", True),
     ("soy sauce", "Datu Puti soy sauce 1L", True), ("soy sauce", "Sauce mix", False),
     ("tomato", "Tomatoes", True), ("rice", "Glutinous rice 1kg", True),
     ("glutinous rice", "Rice 5kg", False), ("chicken", "Chicken 1kg", True),
     ("potato", "Potatoes 1kg", True)],
)  # fmt: skip
def test_name_matching(ingredient: str, product: str, ok: bool) -> None:
    assert matching.name_matches(ingredient, product) is ok


def test_ingredient_status_prefers_enough_and_flags_unknown_units() -> None:
    pantry = [
        PantryItem("p1", "Eggs large", D("12"), "pcs"),
        PantryItem("p2", "Onion", D("1"), None),
        PantryItem("p3", "Chicken 1kg", D("0.2"), "kg"),
        PantryItem("p4", "Tomatoes", D("0"), "pcs"),  # depleted
    ]
    status = {
        n: matching.ingredient_status(Need(n, D(q), u), pantry).status
        for n, q, u in [
            ("eggs", "4", "pcs"),
            ("onion", "1", "pcs"),
            ("chicken", "1", "kg"),
            ("tomato", "2", "pcs"),
            ("garlic", "1", "head"),
        ]
    }
    assert status == {
        "eggs": "available",
        "onion": "check_amount",  # no unit on the receipt: available, amount not known
        "chicken": "missing",  # 0.2 kg < 1 kg
        "tomato": "missing",  # quantity 0
        "garlic": "missing",
    }


def test_match_percent_counts_check_amount_as_available() -> None:
    def s(status: str) -> matching.IngredientStatus:
        return matching.IngredientStatus(Need("x", D(1), None), status, None)

    assert matching.match_pct([s("available"), s("check_amount"), s("missing")]) == 66
    assert matching.match_pct([s("available")] * 3) == 100
    assert matching.match_pct([]) == 0


def test_more_specific_catalog_ingredients_win() -> None:
    catalog = frozenset({"fish", "fish sauce", "tomato", "tomato sauce", "beef", "corned beef"})
    pantry = [
        PantryItem("p1", "Rufina fish sauce 350ml", D("1"), "bottle"),
        PantryItem("p2", "Del Monte tomato sauce 250g", D("1"), "pack"),
        PantryItem("p3", "Corned beef 150g", D("1"), "can"),
        PantryItem("p4", "Beef brisket", D("1"), "kg"),
    ]
    status = lambda n, q, u: matching.ingredient_status(Need(n, D(q), u), pantry, catalog)  # noqa: E731
    assert status("fish", "500", "g").status == "missing"  # fish sauce isn't fish
    assert status("fish sauce", "30", "ml").status == "check_amount"
    assert status("tomato", "2", "pcs").status == "missing"
    assert status("beef", "500", "g").pantry.name == "Beef brisket"  # not the corned beef
    # Without the catalog (old behaviour) the shorter name would have matched.
    assert matching.ingredient_status(Need("fish", D(500), "g"), pantry).status != "missing"
