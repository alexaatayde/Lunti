"""Migration 0005 (recipe details): additive, fills only the seeded recipes, rolls back exactly.

Also checks the content itself (no database): every seeded recipe has steps, its total time is
unchanged from 0003, and the steps use the recipe's own ingredients.
"""

import importlib.util
import re
import uuid
from collections.abc import Callable
from pathlib import Path

import pytest
from sqlalchemy import text

from alembic import command
from conftest import ThrowawayDatabase, alembic_config, insert_auth_user

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _load(filename: str, name: str):  # noqa: ANN202
    spec = importlib.util.spec_from_file_location(name, VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


M3 = _load("0003_recipe_catalog.py", "m0003_for_0005")
M5 = _load("0005_recipe_details.py", "m0005")
CATALOG = {name: (servings, prep, items) for name, servings, prep, items in M3.CATALOG}

SNAPSHOT = (
    "select (select count(*) from recipes), (select count(*) from recipe_ingredients),"
    " (select count(*) from transactions), (select sum(amount) from transactions),"
    " (select count(*) from profiles), (select count(*) from shopping_list_items)"
)
INGREDIENTS = (
    "select id, recipe_id, name, quantity_required, unit from recipe_ingredients order by id"
)


# ---------- content (no database) ----------


def test_details_cover_exactly_the_seeded_recipes() -> None:
    assert set(M5.DETAILS) == set(CATALOG)


@pytest.mark.parametrize("name", sorted(CATALOG))
def test_each_recipe_is_complete_and_keeps_its_total_time(name: str) -> None:
    prep, cook, staples, steps = M5.DETAILS[name]
    assert prep > 0 and cook > 0
    assert prep + cook == CATALOG[name][1]  # same total as 0003, so ranking is unchanged
    assert 3 <= len(steps) <= 30 and len(staples) <= 20
    assert all(0 < len(s.strip()) <= 500 and s == s.strip() for s in steps)
    assert all(0 < len(s) <= 120 for s in staples)
    assert len(set(steps)) == len(steps)


def _words(value: str) -> list[str]:
    return re.findall(r"[a-z]+", value.lower())


@pytest.mark.parametrize("name", sorted(CATALOG))
def test_steps_use_every_listed_ingredient(name: str) -> None:
    """Internal consistency: each ingredient is mentioned in the steps (any word of its name,
    allowing plurals: "potato" → "potatoes")."""
    _, _, staples, steps = M5.DETAILS[name]
    text_words = _words(" ".join(steps))
    for ingredient, _, _ in CATALOG[name][2]:
        stems = [w.rstrip("s") for w in _words(ingredient) if len(w) > 2]
        assert any(t.startswith(s) for s in stems for t in text_words), (name, ingredient)


@pytest.mark.parametrize("name", sorted(CATALOG))
def test_no_health_or_nutrition_claims(name: str) -> None:
    _, _, staples, steps = M5.DETAILS[name]
    body = " ".join(steps + staples).lower()
    for claim in ("calorie", "healthy", "nutrient", "protein", "vitamin", "diet", "cure"):
        assert claim not in body, (name, claim)


# ---------- migration (throwaway database) ----------


@pytest.mark.db
def test_0005_is_additive_and_round_trips(
    fresh_database_factory: Callable[[], ThrowawayDatabase],
) -> None:
    assert (M5.revision, M5.down_revision) == ("0005_recipe_details", "0004_idempotency_keys")
    db = fresh_database_factory()
    admin = db.admin_engine()
    config = alembic_config(db.app_url)
    try:
        command.upgrade(config, "0004_idempotency_keys")
        user = insert_auth_user(admin)
        admin_recipe = uuid.uuid4()
        with admin.begin() as conn:
            conn.execute(
                text(
                    "insert into transactions (user_id, category_id, amount, occurred_at)"
                    " select :u, id, 400, now() from categories where name = 'Groceries'"
                ),
                {"u": user},
            )
            conn.execute(
                text(
                    "insert into recipes (id, name, servings, prep_time_minutes)"
                    " values (:r, 'Admin dish', 2, 35)"
                ),
                {"r": admin_recipe},
            )

        def snapshot() -> tuple:
            with admin.connect() as conn:
                return tuple(conn.execute(text(SNAPSHOT)).one())

        def recipe_times() -> dict:
            with admin.connect() as conn:
                return dict(conn.execute(text("select id, prep_time_minutes from recipes")).all())

        def ingredients() -> list:
            with admin.connect() as conn:
                return conn.execute(text(INGREDIENTS)).all()

        before, times_before, ingredients_before = snapshot(), recipe_times(), ingredients()

        command.upgrade(config, "0005_recipe_details")
        assert snapshot() == before  # no rows added or removed anywhere
        assert ingredients() == ingredients_before  # ingredient rows untouched
        with admin.connect() as conn:
            rows = {
                r.id: r
                for r in conn.execute(
                    text(
                        "select id, prep_time_minutes, cook_time_minutes, steps, staples"
                        " from recipes"
                    )
                )
            }
        own = rows[admin_recipe]  # admin rows: defaults, same total time
        assert (own.prep_time_minutes, own.cook_time_minutes, own.steps, own.staples) == (
            35,
            0,
            [],
            [],
        )
        adobo = rows[M3.recipe_id("Chicken adobo")]
        assert (adobo.prep_time_minutes, adobo.cook_time_minutes) == (15, 45)
        assert adobo.steps == M5.DETAILS["Chicken adobo"][3]
        for rid, row in rows.items():
            assert row.prep_time_minutes + row.cook_time_minutes == times_before[rid]

        # The app role still reads the catalog (table-level grant + read policy).
        with admin.begin() as conn:
            conn.execute(text("set local role lunti_app_user"))
            assert (
                conn.execute(text("select count(*) from recipes where steps <> '{}'")).scalar()
                == 20
            )  # noqa: E501
        # Constraints hold.
        with pytest.raises(Exception, match="ck_recipes_cook_time_non_negative"):
            with admin.begin() as conn:
                conn.execute(
                    text("update recipes set cook_time_minutes = -1 where id = :r"),
                    {"r": admin_recipe},
                )

        command.downgrade(config, "0004_idempotency_keys")
        assert snapshot() == before
        assert recipe_times() == times_before  # 0003's whole-time values come back exactly
        assert ingredients() == ingredients_before
        with admin.connect() as conn:
            cols = set(
                conn.execute(
                    text(
                        "select column_name from information_schema.columns"
                        " where table_name = 'recipes'"
                    )
                ).scalars()
            )
        assert not cols & {"cook_time_minutes", "steps", "staples"}

        command.upgrade(config, "head")  # up again after a rollback
        assert snapshot() == before
    finally:
        admin.dispose()
