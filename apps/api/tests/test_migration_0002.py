"""Migration 0002 on a database that already holds Step 1–5 data (like the live project)."""

import uuid
from collections.abc import Callable

import pytest
from sqlalchemy import text

from alembic import command
from conftest import ThrowawayDatabase, alembic_config, insert_auth_user

pytestmark = pytest.mark.db


def test_0002_upgrades_existing_data_and_downgrades_cleanly(
    fresh_database_factory: Callable[[], ThrowawayDatabase],
) -> None:
    db = fresh_database_factory()
    admin = db.admin_engine()
    config = alembic_config(db.app_url)
    try:
        command.upgrade(config, "0001_initial_schema")
        user = insert_auth_user(admin)
        product, suggestion, note = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        with admin.begin() as conn:
            conn.execute(
                text(
                    "insert into products (id, user_id, name, normalized_name)"
                    " values (:p, :u, 'Rice', 'rice')"
                ),
                {"p": product, "u": user},
            )
            conn.execute(
                text(
                    "insert into replenishment_suggestions (id, user_id, product_id,"
                    " predicted_date, confidence_score)"
                    " values (:s, :u, :p, current_date, 0.9)"
                ),
                {"s": suggestion, "u": user, "p": product},
            )
            conn.execute(
                text("insert into notifications (id, user_id, type) values (:n, :u, 'budget')"),
                {"n": note, "u": user},
            )

        command.upgrade(config, "head")
        with admin.connect() as conn:
            row = conn.execute(
                text(
                    "select anchor_date, quantity, status"
                    " from replenishment_suggestions where id = :s"
                ),
                {"s": suggestion},
            ).one()
            assert tuple(row) == (None, None, "pending")  # existing rows untouched
            assert (
                conn.execute(
                    text("select dedupe_key from notifications where id = :n"), {"n": note}
                ).scalar_one()
                is None
            )
            # RLS still on, and the new function is callable only by the app role.
            assert conn.execute(
                text("select relrowsecurity from pg_class where relname = 'notifications'")
            ).scalar_one()
            can = (
                conn.execute(
                    text(
                        "select has_function_privilege(r,"
                        " 'lunti_private.claim_device_token(text, text)', 'execute')"
                        " from (values ('lunti_app_user'), ('anon'), ('authenticated')) v(r)"
                    )
                )
                .scalars()
                .all()
            )
            assert can == [True, False, False]

        command.downgrade(config, "0001_initial_schema")
        with admin.connect() as conn:
            cols = (
                conn.execute(
                    text(
                        "select column_name from information_schema.columns where table_name in"
                        " ('replenishment_suggestions', 'notifications') and column_name in"
                        " ('anchor_date', 'quantity', 'dedupe_key')"
                    )
                )
                .scalars()
                .all()
            )
            assert cols == []
            assert (
                conn.execute(text("select count(*) from replenishment_suggestions")).scalar_one()
                == 1
            )  # data rows survive the downgrade
        command.upgrade(config, "head")
    finally:
        admin.dispose()
