"""Row Level Security: one user can never see or change another user's rows, even with
hand-written SQL that forgets the user_id filter (needs TEST_DATABASE_URL)."""

import uuid
from collections.abc import Callable
from decimal import Decimal

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError, ProgrammingError
from sqlalchemy.orm import Session

pytestmark = pytest.mark.db

AsUser = Callable[[uuid.UUID | None], Session]


@pytest.fixture
def two_users(make_user) -> tuple[uuid.UUID, uuid.UUID]:
    return make_user(metadata={"full_name": "Alice"}), make_user(metadata={"full_name": "Bob"})


def _own_category(admin_engine: Engine, user_id: uuid.UUID, name: str) -> uuid.UUID:
    with admin_engine.begin() as conn:
        return conn.execute(
            text("insert into categories (user_id, name) values (:u, :n) returning id"),
            {"u": user_id, "n": name},
        ).scalar_one()


def _groceries(admin_engine: Engine) -> uuid.UUID:
    with admin_engine.connect() as conn:
        return conn.execute(text("select id from categories where name = 'Groceries'")).scalar_one()


def test_unfiltered_queries_only_return_the_callers_rows(
    as_user: AsUser, admin_engine: Engine, two_users
) -> None:
    alice, bob = two_users
    _own_category(admin_engine, bob, "Bob's secret category")

    db = as_user(alice)
    profiles = db.execute(text("select user_id from profiles")).scalars().all()
    prefs = db.execute(text("select user_id from user_preferences")).scalars().all()
    categories = db.execute(text("select name from categories")).scalars().all()

    assert profiles == [alice]
    assert prefs == [alice]
    assert "Bob's secret category" not in categories
    assert "Groceries" in categories


def test_no_caller_means_no_user_rows(as_user: AsUser, two_users) -> None:
    db = as_user(None)

    assert db.execute(text("select count(*) from profiles")).scalar_one() == 0
    names = db.execute(text("select name from categories")).scalars().all()
    assert len(names) == 6  # only the shared defaults


def test_cannot_update_or_delete_another_users_rows(
    as_user: AsUser, admin_engine: Engine, two_users
) -> None:
    alice, bob = two_users
    bobs_category = _own_category(admin_engine, bob, "Bob only")
    db = as_user(alice)

    renamed = db.execute(
        text("update profiles set full_name = 'hacked' where user_id = :b"), {"b": bob}
    )
    deleted = db.execute(text("delete from categories where id = :c"), {"c": bobs_category})

    assert renamed.rowcount == 0
    assert deleted.rowcount == 0


def test_cannot_create_rows_for_another_user(as_user: AsUser, two_users) -> None:
    alice, bob = two_users
    db = as_user(alice)

    with pytest.raises(ProgrammingError, match="row-level security"):
        db.execute(
            text("insert into categories (user_id, name) values (:b, 'Planted')"), {"b": bob}
        )


def test_cannot_change_role_or_consent_records(as_user: AsUser, two_users) -> None:
    alice, _ = two_users

    for column, value in [("role", "'admin'"), ("terms_accepted_at", "now()")]:
        db = as_user(alice)
        with pytest.raises(ProgrammingError, match="permission denied"):
            db.execute(
                text(f"update profiles set {column} = {value} where user_id = :a"), {"a": alice}
            )
        db.rollback()


def test_default_categories_are_read_only(as_user: AsUser, two_users, admin_engine) -> None:
    alice, _ = two_users
    groceries = _groceries(admin_engine)
    db = as_user(alice)

    result = db.execute(text("update categories set name = 'Mine' where id = :g"), {"g": groceries})
    assert result.rowcount == 0
    db.rollback()

    db = as_user(alice)
    with pytest.raises(ProgrammingError, match="permission denied"):
        db.execute(text("update categories set is_default = false where id = :g"), {"g": groceries})


def test_transactions_cannot_use_another_users_category(
    as_user: AsUser, admin_engine: Engine, two_users
) -> None:
    alice, bob = two_users
    bobs_category = _own_category(admin_engine, bob, "Bob groceries")
    insert = text(
        "insert into transactions (user_id, category_id, amount, occurred_at)"
        " values (:u, :c, :a, now()) returning id"
    )

    db = as_user(alice)
    own = db.execute(
        insert, {"u": alice, "c": _groceries(admin_engine), "a": Decimal("120.50")}
    ).scalar_one()
    assert own is not None

    with pytest.raises(ProgrammingError, match="row-level security"):
        db.execute(insert, {"u": alice, "c": bobs_category, "a": Decimal("1.00")})


def test_line_items_follow_their_transaction(
    as_user: AsUser, admin_engine: Engine, two_users
) -> None:
    alice, bob = two_users
    with admin_engine.begin() as conn:
        bobs_txn = conn.execute(
            text(
                "insert into transactions (user_id, category_id, amount, occurred_at)"
                " values (:u, :c, 10, now()) returning id"
            ),
            {"u": bob, "c": _groceries(admin_engine)},
        ).scalar_one()
        conn.execute(
            text(
                "insert into transaction_line_items (transaction_id, name, unit_price, line_total)"
                " values (:t, 'Rice', 10, 10)"
            ),
            {"t": bobs_txn},
        )

    db = as_user(alice)
    assert db.execute(text("select count(*) from transaction_line_items")).scalar_one() == 0
    with pytest.raises(ProgrammingError, match="row-level security"):
        db.execute(
            text(
                "insert into transaction_line_items (transaction_id, name, unit_price, line_total)"
                " values (:t, 'Injected', 1, 1)"
            ),
            {"t": bobs_txn},
        )


def test_recipe_catalog_is_read_only_for_the_app(as_user: AsUser, two_users) -> None:
    alice, _ = two_users
    db = as_user(alice)

    assert db.execute(text("select count(*) from recipes")).scalar_one() >= 0
    with pytest.raises(ProgrammingError, match="permission denied"):
        db.execute(
            text("insert into recipes (name, servings, prep_time_minutes) values ('x', 1, 1)")
        )


def test_database_constraints_reject_bad_money(as_user: AsUser, admin_engine, two_users) -> None:
    alice, _ = two_users
    db = as_user(alice)

    with pytest.raises(DBAPIError, match="ck_transactions_amount_non_negative"):
        db.execute(
            text(
                "insert into transactions (user_id, category_id, amount, occurred_at)"
                " values (:u, :c, -5, now())"
            ),
            {"u": alice, "c": _groceries(admin_engine)},
        )


def test_updated_at_is_maintained(as_user: AsUser, two_users) -> None:
    alice, _ = two_users
    db = as_user(alice)
    before = db.execute(
        text("select updated_at from profiles where user_id = :a"), {"a": alice}
    ).scalar_one()

    after = db.execute(
        text("update profiles set full_name = 'Alice R' where user_id = :a returning updated_at"),
        {"a": alice},
    ).scalar_one()

    assert after >= before
    assert after == db.execute(text("select now()")).scalar_one()
