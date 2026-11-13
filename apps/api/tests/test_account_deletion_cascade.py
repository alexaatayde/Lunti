"""Account deletion groundwork (SRS 3.5.5, Phase 8A): deleting a user from `auth.users` — what
the Supabase Auth Admin API does — must remove every row the user owns, and nothing of anyone
else's. Runs only on a throwaway database (needs TEST_DATABASE_URL); nothing here touches a
real account.

Files outside the database (receipt photos in Storage) are NOT covered by the cascade; see the
account-deletion design for how they are removed.
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import Engine, text

pytestmark = pytest.mark.db

# Every table with a user_id column. A new user-owned table must be added here (and must
# cascade from auth.users), or this test fails.
USER_TABLES = {
    "budgets",
    "categories",
    "device_tokens",
    "feedback",
    "ingredient_inventory",
    "insights",
    "notifications",
    "products",
    "profiles",
    "purchase_patterns",
    "receipts",
    "replenishment_suggestions",
    "shopping_lists",
    "transactions",
    "user_preferences",
}
# Child tables without user_id, removed through their parent.
CHILD_TABLES = {
    "transaction_line_items": "transactions",
    "shopping_list_items": "shopping_lists",
}


def _populate(admin_engine: Engine, user_id: uuid.UUID) -> None:
    """One row (at least) in every user-owned table, linked the way the app links them —
    including a custom category used by a transaction and a budget (ON DELETE RESTRICT)."""
    p = {"u": user_id, "today": date.today()}
    with admin_engine.begin() as conn:

        def one(sql: str, **extra) -> uuid.UUID:
            return conn.execute(text(sql), {**p, **extra}).scalar_one()

        cat = one("insert into categories (user_id, name) values (:u, 'ZZ Custom') returning id")
        receipt = one(
            "insert into receipts (user_id, image_path, ocr_status, confirmed_at)"
            " values (:u, 'receipts/x.jpg', 'confirmed', now()) returning id"
        )
        product = one(
            "insert into products (user_id, name, normalized_name, is_food, default_category_id)"
            " values (:u, 'Rice', 'rice', true, :c) returning id",
            c=cat,
        )
        txn = one(
            "insert into transactions (user_id, category_id, amount, occurred_at, source,"
            " receipt_id) values (:u, :c, 10, now(), 'receipt', :r) returning id",
            c=cat,
            r=receipt,
        )
        one(
            "insert into transaction_line_items (transaction_id, product_id, name, quantity,"
            " unit_price, line_total) values (:t, :p, 'Rice', 1, 10, 10) returning id",
            t=txn,
            p=product,
        )
        one(
            "insert into budgets (user_id, category_id, period_type, start_date, limit_amount)"
            " values (:u, :c, 'monthly', :today, 100) returning id",
            c=cat,
        )
        pattern = one(
            "insert into purchase_patterns (user_id, product_id) values (:u, :p) returning id",
            p=product,
        )
        suggestion = one(
            "insert into replenishment_suggestions (user_id, product_id, pattern_id,"
            " predicted_date, confidence_score) values (:u, :p, :pt, :today, 0.8) returning id",
            p=product,
            pt=pattern,
        )
        lst = one("insert into shopping_lists (user_id) values (:u) returning id")
        recipe = one("select id from recipes limit 1")
        one(
            "insert into shopping_list_items (shopping_list_id, name, product_id, recipe_id,"
            " source) values (:l, 'Rice', :p, :r, 'recipe') returning id",
            l=lst,
            p=product,
            r=recipe,
        )
        one(
            "insert into ingredient_inventory (user_id, product_id, estimated_quantity)"
            " values (:u, :p, 1) returning id",
            p=product,
        )
        one(
            "insert into insights (user_id, type, message) values (:u, 'summary', 'x') returning id"
        )
        one("insert into notifications (user_id, type) values (:u, 'budget') returning id")
        one(
            "insert into device_tokens (user_id, fcm_token, platform)"
            " values (:u, :tok, 'android') returning id",
            tok=f"token-{user_id}",
        )
        one(
            "insert into feedback (user_id, target_type, target_id, action)"
            " values (:u, 'replenishment_suggestion', :s, 'dismiss') returning id",
            s=suggestion,
        )


def _counts(admin_engine: Engine, user_id: uuid.UUID) -> dict[str, int]:
    with admin_engine.connect() as conn:
        counts = {
            table: conn.execute(
                text(f"select count(*) from {table} where user_id = :u"), {"u": user_id}
            ).scalar_one()
            for table in USER_TABLES
        }
        for child, parent in CHILD_TABLES.items():
            fk = "transaction_id" if parent == "transactions" else "shopping_list_id"
            counts[child] = conn.execute(
                text(
                    f"select count(*) from {child} c join {parent} p on p.id = c.{fk}"
                    " where p.user_id = :u"
                ),
                {"u": user_id},
            ).scalar_one()
    return counts


def test_user_owned_tables_are_all_known(admin_engine: Engine) -> None:
    with admin_engine.connect() as conn:
        tables = set(
            conn.execute(
                text(
                    "select table_name from information_schema.columns"
                    " where table_schema = 'public' and column_name = 'user_id'"
                )
            ).scalars()
        )
    assert tables == USER_TABLES


def test_every_reference_to_auth_users_cascades(admin_engine: Engine) -> None:
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text(
                "select conrelid::regclass::text, confdeltype from pg_constraint"
                " where contype = 'f' and confrelid = 'auth.users'::regclass"
            )
        ).all()
    assert {table for table, _ in rows} == USER_TABLES
    assert {table for table, action in rows if action != "c"} == set()


def test_deleting_the_auth_user_removes_all_their_rows_and_only_theirs(
    admin_engine: Engine, make_user
) -> None:
    leaving, staying = make_user(), make_user()
    _populate(admin_engine, leaving)
    _populate(admin_engine, staying)
    before_staying = _counts(admin_engine, staying)
    assert all(_counts(admin_engine, leaving).values())  # every table really had a row
    with admin_engine.connect() as conn:
        recipes_before = conn.execute(text("select count(*) from recipes")).scalar_one()

    # What Supabase Auth's admin delete does to the database.
    with admin_engine.begin() as conn:
        conn.execute(text("set local role supabase_auth_admin"))
        conn.execute(text("delete from auth.users where id = :u"), {"u": leaving})

    assert _counts(admin_engine, leaving) == dict.fromkeys(_counts(admin_engine, leaving), 0)
    assert _counts(admin_engine, staying) == before_staying
    with admin_engine.connect() as conn:
        # The shared recipe catalog is not user data.
        assert conn.execute(text("select count(*) from recipes")).scalar_one() == recipes_before
