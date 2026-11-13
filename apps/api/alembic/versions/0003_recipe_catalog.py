"""Starter recipe catalog: 20 Filipino home dishes (data only, no schema change).

Revision ID: 0003_recipe_catalog
Revises: 0002_replenishment_notifications
Create Date: 2026-11-13

PROVISIONAL: approved 2026-11-13 as a starter MVP catalog (AGENTS.md §7.5, §13); the recipe
contents (dishes, quantities, servings, prep times) are subject to team review and have not
been independently verified. Name, servings, prep time and ingredients with quantities and
units. No nutrition, prices or photos. Common staples (salt,
pepper, water) are left out. Rows have fixed ids, so re-running inserts nothing, and the
downgrade removes only these rows. Admins add more through POST /api/v1/admin/recipes.
"""

import uuid
from collections.abc import Sequence

from alembic import op

revision: str = "0003_recipe_catalog"
down_revision: str | None = "0002_replenishment_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NAMESPACE = uuid.UUID("3b0f6c6e-6d1e-4c7b-9a51-0b1d2f7e5a10")

# (name, servings, prep minutes, [(ingredient, quantity, unit)])
CATALOG = [
    ("Chicken adobo", 4, 60, [("chicken", "1", "kg"), ("soy sauce", "120", "ml"),
        ("vinegar", "120", "ml"), ("garlic", "1", "head"), ("onion", "1", "pcs")]),
    ("Pork sinigang", 4, 75, [("pork", "1", "kg"), ("sinigang mix", "1", "pack"),
        ("tomato", "2", "pcs"), ("radish", "1", "pcs"), ("kangkong", "1", "bunch"),
        ("onion", "1", "pcs")]),
    ("Tortang talong", 2, 25, [("eggplant", "2", "pcs"), ("eggs", "2", "pcs"),
        ("cooking oil", "3", "tbsp")]),
    ("Ginisang monggo", 4, 50, [("mung beans", "250", "g"), ("garlic", "1", "head"),
        ("onion", "1", "pcs"), ("tomato", "2", "pcs"), ("malunggay", "1", "bunch")]),
    ("Pancit canton", 4, 35, [("canton noodles", "250", "g"), ("cabbage", "250", "g"),
        ("carrot", "1", "pcs"), ("chicken", "250", "g"), ("soy sauce", "45", "ml"),
        ("garlic", "1", "head")]),
    ("Arroz caldo", 4, 50, [("rice", "200", "g"), ("chicken", "500", "g"), ("ginger", "50", "g"),
        ("garlic", "1", "head"), ("fish sauce", "30", "ml")]),
    ("Chicken tinola", 4, 50, [("chicken", "1", "kg"), ("green papaya", "1", "pcs"),
        ("ginger", "50", "g"), ("malunggay", "1", "bunch"), ("fish sauce", "30", "ml"),
        ("onion", "1", "pcs")]),
    ("Pork menudo", 5, 70, [("pork", "500", "g"), ("potato", "2", "pcs"), ("carrot", "1", "pcs"),
        ("tomato sauce", "250", "ml"), ("bell pepper", "1", "pcs"), ("garlic", "1", "head")]),
    ("Sinangag (garlic fried rice)", 2, 15, [("rice", "300", "g"), ("garlic", "1", "head"),
        ("cooking oil", "2", "tbsp")]),
    ("Beef tapa with egg", 2, 30, [("beef", "500", "g"), ("soy sauce", "60", "ml"),
        ("garlic", "1", "head"), ("eggs", "2", "pcs"), ("rice", "300", "g")]),
    ("Ginataang kalabasa at sitaw", 4, 40, [("squash", "500", "g"),
        ("string beans", "1", "bunch"), ("coconut milk", "400", "ml"), ("shrimp", "250", "g"),
        ("garlic", "1", "head"), ("onion", "1", "pcs")]),
    ("Chopsuey", 4, 30, [("cabbage", "250", "g"), ("carrot", "1", "pcs"),
        ("broccoli", "250", "g"), ("chicken", "250", "g"), ("garlic", "1", "head"),
        ("oyster sauce", "30", "ml")]),
    ("Bistek Tagalog", 4, 40, [("beef", "500", "g"), ("soy sauce", "60", "ml"),
        ("calamansi", "10", "pcs"), ("onion", "2", "pcs")]),
    ("Pinakbet", 4, 45, [("squash", "250", "g"), ("eggplant", "2", "pcs"), ("okra", "8", "pcs"),
        ("ampalaya", "1", "pcs"), ("string beans", "1", "bunch"), ("shrimp paste", "30", "g"),
        ("pork", "250", "g")]),
    ("Paksiw na isda", 3, 35, [("fish", "500", "g"), ("vinegar", "120", "ml"),
        ("ginger", "30", "g"), ("garlic", "1", "head"), ("eggplant", "1", "pcs")]),
    ("Lugaw", 4, 45, [("rice", "200", "g"), ("ginger", "30", "g"), ("garlic", "1", "head"),
        ("eggs", "2", "pcs")]),
    ("Corned beef with potatoes", 3, 20, [("corned beef", "1", "can"), ("potato", "2", "pcs"),
        ("onion", "1", "pcs"), ("garlic", "1", "head")]),
    ("Sardinas with misua", 3, 15, [("sardines", "1", "can"), ("misua", "1", "pack"),
        ("onion", "1", "pcs"), ("garlic", "1", "head")]),
    ("Scrambled eggs with tomatoes", 2, 10, [("eggs", "4", "pcs"), ("tomato", "2", "pcs"),
        ("onion", "1", "pcs")]),
    ("Champorado", 4, 30, [("glutinous rice", "200", "g"), ("cocoa", "100", "g"),
        ("sugar", "100", "g"), ("evaporated milk", "370", "ml")]),
]  # fmt: skip


def recipe_id(name: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, f"recipe:{name}")


def ingredient_id(recipe: str, ingredient: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, f"ingredient:{recipe}:{ingredient}")


def _q(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def upgrade() -> None:
    # Literal SQL (static, reviewed data), so `alembic upgrade --sql` can print it for review.
    recipes = ",\n  ".join(
        f"({_q(str(recipe_id(name)))}, {_q(name)}, {servings}, {prep})"
        for name, servings, prep, _ in CATALOG
    )
    op.execute(
        "insert into public.recipes (id, name, servings, prep_time_minutes) values\n  "
        + recipes
        + "\non conflict (id) do nothing;"
    )
    ingredients = ",\n  ".join(
        f"({_q(str(ingredient_id(name, ing)))}, {_q(str(recipe_id(name)))}, {_q(ing)}, "
        f"{quantity}, {_q(unit)})"
        for name, _, _, items in CATALOG
        for ing, quantity, unit in items
    )
    op.execute(
        "insert into public.recipe_ingredients (id, recipe_id, name, quantity_required, unit)"
        " values\n  " + ingredients + "\non conflict (id) do nothing;"
    )


def downgrade() -> None:
    ids = ", ".join(_q(str(recipe_id(name))) for name, *_ in CATALOG)
    op.execute(f"delete from public.recipes where id in ({ids});")  # ingredients cascade
