"""Migration 0003 (recipe catalog): only the seeded rows, idempotent, user data untouched."""

import importlib.util
import uuid
from collections.abc import Callable
from pathlib import Path

import pytest
from sqlalchemy import text

from alembic import command
from conftest import ThrowawayDatabase, alembic_config, insert_auth_user

pytestmark = pytest.mark.db

CATALOG_COUNTS = "select (select count(*) from recipes), (select count(*) from recipe_ingredients)"
SNAPSHOT = (
    "select (select count(*) from recipes), (select count(*) from recipe_ingredients),"
    " (select count(*) from transactions), (select sum(amount) from transactions),"
    " (select count(*) from profiles)"
)

MIGRATION = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0003_recipe_catalog.py"


def _migration():  # noqa: ANN202
    spec = importlib.util.spec_from_file_location("m0003", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_0003_seeds_only_the_catalog_and_downgrades_only_it(
    fresh_database_factory: Callable[[], ThrowawayDatabase],
) -> None:
    m = _migration()
    assert (m.revision, m.down_revision) == (
        "0003_recipe_catalog",
        "0002_replenishment_notifications",
    )
    db = fresh_database_factory()
    admin = db.admin_engine()
    config = alembic_config(db.app_url)
    try:
        command.upgrade(config, "0002_replenishment_notifications")
        user = insert_auth_user(admin)
        own_recipe = uuid.uuid4()
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
                    " values (:r, 'Admin dish', 2, 10)"
                ),
                {"r": own_recipe},
            )

        def snapshot() -> tuple:
            with admin.connect() as conn:
                return conn.execute(text(SNAPSHOT)).one()

        before = snapshot()
        command.upgrade(config, "head")
        after = snapshot()
        assert (after[0] - before[0], after[1] - before[1]) == (20, 97)
        assert after[2:] == before[2:]  # user and financial rows untouched

        seeded = m.recipe_id("Chicken adobo")
        command.downgrade(config, "0002_replenishment_notifications")
        with admin.connect() as conn:
            left = conn.execute(text("select id from recipes")).scalars().all()
        assert left == [own_recipe]  # only the seeded rows were removed
        assert snapshot()[2:] == before[2:]

        command.upgrade(config, "head")
        with admin.begin() as conn:
            conn.execute(text("update recipes set servings = 6 where id = :r"), {"r": seeded})
        # Re-running the seed changes nothing and keeps an admin's edit (on conflict do nothing).
        with admin.begin() as conn:
            from alembic.migration import MigrationContext
            from alembic.operations import Operations

            m.op = Operations(MigrationContext.configure(conn))
            m.upgrade()
        with admin.connect() as conn:
            counts = conn.execute(text(CATALOG_COUNTS)).one()
            servings = conn.execute(
                text("select servings from recipes where id = :r"), {"r": seeded}
            ).scalar_one()
        assert tuple(counts) == (after[0], after[1])
        assert servings == 6
    finally:
        admin.dispose()
