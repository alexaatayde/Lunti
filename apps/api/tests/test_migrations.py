"""Migrations on a throwaway PostgreSQL database (needs TEST_DATABASE_URL)."""

import json
from collections.abc import Callable

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, text
from sqlalchemy.exc import ProgrammingError

from alembic import command
from app.models import metadata
from conftest import (
    ThrowawayDatabase,
    alembic_config,
    insert_auth_user,
    make_engine,
)

pytestmark = pytest.mark.db

LUNTI_TABLES = sorted(t.name for t in metadata.sorted_tables if t.schema != "auth")


def test_head_is_applied(database: ThrowawayDatabase, admin_engine: Engine) -> None:
    head = ScriptDirectory.from_config(alembic_config(database.app_url)).get_current_head()
    with admin_engine.connect() as conn:
        version = conn.execute(text("select version_num from alembic_version")).scalar_one()
        tables = conn.execute(
            text("select tablename from pg_tables where schemaname = 'public' order by 1")
        ).scalars()
        assert version == head
        assert set(LUNTI_TABLES) <= set(tables)


def test_models_match_the_migrated_schema(app_engine: Engine) -> None:
    """The SQLAlchemy models and the migration must describe the same schema."""

    def include(obj, name, type_, reflected, compare_to):  # noqa: ANN001
        if type_ == "table":
            return name != "alembic_version" and getattr(obj, "schema", None) != "auth"
        return True

    with app_engine.connect() as conn:
        context = MigrationContext.configure(
            conn, opts={"include_object": include, "compare_type": True}
        )
        diffs = compare_metadata(context, metadata)

    assert diffs == []


def test_every_table_has_rls_and_no_data_api_access(admin_engine: Engine) -> None:
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text(
                "select c.relname, c.relrowsecurity from pg_class c"
                " join pg_namespace n on n.oid = c.relnamespace"
                " where n.nspname = 'public' and c.relkind = 'r'"
            )
        ).all()
        assert {name for name, rls in rows if not rls} == set()

        for role in ("anon", "authenticated"):
            granted = conn.execute(
                text(
                    "select table_name from information_schema.role_table_grants"
                    " where grantee = :role and table_schema = 'public'"
                ),
                {"role": role},
            ).scalars()
            assert list(granted) == [], f"{role} can reach tables through the Data API"


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_data_api_roles_cannot_read_user_data(admin_engine: Engine, role: str) -> None:
    with admin_engine.connect() as conn, conn.begin():
        conn.execute(text(f"set local role {role}"))
        with pytest.raises(ProgrammingError, match="permission denied"):
            conn.execute(text("select * from public.profiles"))


def test_default_categories_are_seeded_in_design_order(admin_engine: Engine) -> None:
    with admin_engine.connect() as conn:
        names = conn.execute(
            text("select name from categories where is_default order by sort_order")
        ).scalars()
        assert list(names) == [
            "Groceries",
            "Dining out",
            "Transport",
            "Utilities",
            "Household",
            "Others",
        ]


def test_signup_trigger_creates_profile_and_preferences(admin_engine: Engine) -> None:
    user_id = insert_auth_user(
        admin_engine,
        metadata={
            "full_name": "  Alex Reyes  ",
            "terms_accepted_at": "2026-11-04T00:00:00Z",
            "data_consent_at": "2026-11-04T00:00:00Z",
        },
    )
    with admin_engine.connect() as conn:
        profile = conn.execute(
            text(
                "select p.full_name, p.role, p.currency,"
                " p.terms_accepted_at = u.created_at, p.data_consent_at = u.created_at"
                " from profiles p join auth.users u on u.id = p.user_id where p.user_id = :id"
            ),
            {"id": user_id},
        ).one()
        prefs = conn.execute(
            text(
                "select budget_alert_pct, notify_budget from user_preferences where user_id = :id"
            ),
            {"id": user_id},
        ).one()

    # Consent time is the server's sign-up time, not the client-sent value.
    assert tuple(profile) == ("Alex Reyes", "user", "PHP", True, True)
    assert tuple(prefs) == (90, True)


@pytest.mark.parametrize(
    "metadata",
    [None, {}, {"full_name": "x" * 500}, {"full_name": 42}, {"terms_accepted_at": "garbage"}],
)
def test_signup_never_fails_on_odd_metadata(admin_engine: Engine, metadata) -> None:
    """A failing trigger would block every sign-up, so odd input must still succeed."""
    user_id = insert_auth_user(admin_engine, metadata=metadata)
    with admin_engine.connect() as conn:
        name, terms, consent = conn.execute(
            text(
                "select full_name, terms_accepted_at, data_consent_at from profiles"
                " where user_id = :id"
            ),
            {"id": user_id},
        ).one()
    assert name is None or len(name) <= 100
    assert consent is None
    if not (metadata and "terms_accepted_at" in metadata):
        assert terms is None


def test_deleting_an_auth_user_removes_their_lunti_rows(admin_engine: Engine) -> None:
    user_id = insert_auth_user(admin_engine, metadata={"full_name": "Temp"})
    with admin_engine.begin() as conn:
        conn.execute(text("delete from auth.users where id = :id"), {"id": user_id})
        left = conn.execute(
            text(
                "select (select count(*) from profiles where user_id = :id)"
                " + (select count(*) from user_preferences where user_id = :id)"
            ),
            {"id": user_id},
        ).scalar_one()
    assert left == 0


def test_upgrade_backfills_existing_users_and_downgrade_round_trips(
    fresh_database_factory: Callable[[], ThrowawayDatabase],
) -> None:
    db = fresh_database_factory()
    admin = db.admin_engine()
    config = alembic_config(db.app_url)
    try:
        # A user who signed up before Lunti's tables existed (like Step 1 test accounts).
        early_user = insert_auth_user(
            admin,
            metadata={"full_name": "Early Bird", "terms_accepted_at": "x", "data_consent_at": "x"},
        )

        command.upgrade(config, "head")
        with admin.connect() as conn:
            name, terms = conn.execute(
                text("select full_name, terms_accepted_at from profiles where user_id = :id"),
                {"id": early_user},
            ).one()
        assert name == "Early Bird" and terms is not None

        command.downgrade(config, "base")
        with admin.connect() as conn:
            remaining = conn.execute(
                text(
                    "select count(*) from pg_tables where schemaname = 'public'"
                    " and tablename <> 'alembic_version'"
                )
            ).scalar_one()
            users = conn.execute(text("select count(*) from auth.users")).scalar_one()
        assert remaining == 0
        assert users == 1  # auth.users is never touched

        command.upgrade(config, "head")
        engine = make_engine(db.app_url)
        with engine.connect() as conn:
            assert conn.execute(text("select count(*) from profiles")).scalar_one() == 1
        engine.dispose()
    finally:
        admin.dispose()


def test_migration_runs_as_a_non_superuser(database: ThrowawayDatabase, app_engine: Engine) -> None:
    """Supabase's `postgres` role is not a superuser; the tests migrate the same way."""
    with app_engine.connect() as conn:
        is_super = conn.execute(text("select rolsuper from pg_roles where rolname = current_user"))
        assert is_super.scalar_one() is False
        claims = json.dumps({"sub": "00000000-0000-4000-8000-000000000000"})
        conn.execute(text("select set_config('request.jwt.claims', :c, false)"), {"c": claims})
        conn.execute(text("set role lunti_app_user"))
        assert conn.execute(text("select current_user")).scalar_one() == "lunti_app_user"
        conn.execute(text("reset role"))
