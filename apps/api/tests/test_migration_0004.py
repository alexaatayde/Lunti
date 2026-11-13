"""Migration 0004 (idempotency keys): additive only, RLS on, clean rollback, data untouched."""

import importlib.util
from collections.abc import Callable
from pathlib import Path

import pytest
from sqlalchemy import text

from alembic import command
from conftest import ThrowawayDatabase, alembic_config, insert_auth_user

pytestmark = pytest.mark.db

MIGRATION = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0004_idempotency_keys.py"
)

# Every existing table's row count and the money total: none of it may change.
SNAPSHOT = (
    "select (select count(*) from transactions), (select sum(amount) from transactions),"
    " (select count(*) from budgets), (select count(*) from profiles),"
    " (select count(*) from recipes), (select count(*) from notifications),"
    " (select count(*) from categories)"
)
TABLE_EXISTS = "select to_regclass('public.idempotency_keys') is not null"


def _migration():  # noqa: ANN202
    spec = importlib.util.spec_from_file_location("m0004", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_0004_adds_only_the_keys_table_and_rolls_back_cleanly(
    fresh_database_factory: Callable[[], ThrowawayDatabase],
) -> None:
    m = _migration()
    assert (m.revision, m.down_revision) == ("0004_idempotency_keys", "0003_recipe_catalog")
    db = fresh_database_factory()
    admin = db.admin_engine()
    config = alembic_config(db.app_url)
    try:
        command.upgrade(config, "0003_recipe_catalog")
        user = insert_auth_user(admin)
        with admin.begin() as conn:
            conn.execute(
                text(
                    "insert into transactions (user_id, category_id, amount, occurred_at)"
                    " select :u, id, 400, now() from categories where name = 'Groceries'"
                ),
                {"u": user},
            )
            before = conn.execute(text(SNAPSHOT)).one()

        command.upgrade(config, "0004_idempotency_keys")
        with admin.connect() as conn:
            assert conn.execute(text(SNAPSHOT)).one() == before
            assert conn.execute(text(TABLE_EXISTS)).scalar_one() is True
            rls = conn.execute(
                text(
                    "select relrowsecurity from pg_class"
                    " where oid = 'public.idempotency_keys'::regclass"
                )
            ).scalar_one()
            assert rls is True
            policies = (
                conn.execute(
                    text("select policyname from pg_policies where tablename = 'idempotency_keys'")
                )
                .scalars()
                .all()
            )
            assert policies == ["idempotency_keys_owner"]
            for role in ("anon", "authenticated"):
                granted = conn.execute(
                    text(
                        "select count(*) from information_schema.role_table_grants"
                        " where grantee = :r and table_name = 'idempotency_keys'"
                    ),
                    {"r": role},
                ).scalar_one()
                assert granted == 0, f"{role} can reach idempotency_keys"
            # The transaction can be linked; deleting it unlinks the key (SET NULL).
            txn = conn.execute(text("select id from transactions limit 1")).scalar_one()
        with admin.begin() as conn:
            conn.execute(
                text(
                    "insert into idempotency_keys (user_id, scope, key, request_hash,"
                    " transaction_id) values (:u, 'transactions.create', 'mig-key-0001',"
                    " repeat('a', 64), :t)"
                ),
                {"u": user, "t": txn},
            )

        command.downgrade(config, "0003_recipe_catalog")
        with admin.connect() as conn:
            assert conn.execute(text(TABLE_EXISTS)).scalar_one() is False
            assert conn.execute(text(SNAPSHOT)).one() == before
            version = conn.execute(text("select version_num from alembic_version")).scalar_one()
            assert version == "0003_recipe_catalog"

        command.upgrade(config, "head")
        with admin.connect() as conn:
            assert conn.execute(text(TABLE_EXISTS)).scalar_one() is True
            assert conn.execute(text(SNAPSHOT)).one() == before
    finally:
        admin.dispose()


@pytest.mark.parametrize(
    ("key", "digest", "scope"),
    [
        ("short", "a" * 64, "transactions.create"),
        ("good-key-123", "not-a-hash", "transactions.create"),
        ("good-key-123", "a" * 64, "budgets.create"),
    ],
)
def test_0004_constraints_reject_bad_rows(
    admin_engine,
    make_user,
    key: str,
    digest: str,
    scope: str,  # noqa: ANN001
) -> None:
    from sqlalchemy.exc import IntegrityError

    user = make_user()
    with pytest.raises(IntegrityError), admin_engine.begin() as conn:
        conn.execute(
            text(
                "insert into idempotency_keys (user_id, scope, key, request_hash)"
                " values (:u, :s, :k, :h)"
            ),
            {"u": user, "s": scope, "k": key, "h": digest},
        )
