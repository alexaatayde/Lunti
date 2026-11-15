"""Migration 0006 (OCR leases, usage counters, raw-text retention): additive, existing receipts
untouched, compatible with the previous API's writes, clean rollback."""

import importlib.util
from collections.abc import Callable
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from alembic import command
from conftest import ThrowawayDatabase, alembic_config, insert_auth_user

pytestmark = pytest.mark.db

MIGRATION = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0006_ocr_processing_quota.py"
)

RECEIPTS = (
    "select id, user_id, image_path, ocr_raw_text, ocr_status, confidence_store,"
    " confidence_items, confidence_total, confirmed_at, created_at, updated_at"
    " from receipts order by id"
)
SNAPSHOT = (
    "select (select count(*) from transactions), (select sum(amount) from transactions),"
    " (select count(*) from receipts), (select count(*) from budgets),"
    " (select count(*) from recipes), (select count(*) from idempotency_keys)"
)
NEW_COLUMNS = (
    "select count(*) from information_schema.columns where table_name = 'receipts'"
    " and column_name in ('ocr_attempt_id', 'ocr_lease_expires_at', 'ocr_text_purged_at')"
)
OBJECTS = (
    "select to_regclass('public.ocr_usage_daily') is not null,"
    " to_regprocedure('lunti_private.reserve_ocr_quota(date, integer, integer, boolean)')"
    " is not null,"
    " to_regprocedure('lunti_private.record_ocr_outcome(date, boolean)') is not null"
)


def _migration():  # noqa: ANN202
    spec = importlib.util.spec_from_file_location("m0006", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _old_api_receipts(conn, user) -> None:  # noqa: ANN001
    """Rows exactly as the previous API (f91da2a) writes them: no lease columns."""
    conn.execute(
        text(
            "insert into receipts (user_id, image_path, ocr_raw_text, ocr_status,"
            " confidence_store, confidence_items, confidence_total)"
            " values (cast(:u as uuid), :u || '/a.jpg', 'ZZ MART\nTOTAL 10.00', 'draft', 0.9, 0.9,"
            " 0.9), (cast(:u as uuid), :u || '/b.jpg', null, 'failed', null, null, null)"
        ),
        {"u": str(user)},
    )
    conn.execute(
        text(
            "insert into receipts (user_id, image_path, ocr_raw_text, ocr_status,"
            " confirmed_at) values (cast(:u as uuid), :u || '/c.jpg', 'ZZ', 'confirmed', now())"
        ),
        {"u": str(user)},
    )


def test_0006_is_additive_compatible_and_rolls_back_cleanly(
    fresh_database_factory: Callable[[], ThrowawayDatabase],
) -> None:
    m = _migration()
    assert (m.revision, m.down_revision) == ("0006_ocr_processing_quota", "0005_recipe_details")
    db = fresh_database_factory()
    admin = db.admin_engine()
    config = alembic_config(db.app_url)
    try:
        command.upgrade(config, "0005_recipe_details")
        user = insert_auth_user(admin)
        with admin.begin() as conn:
            _old_api_receipts(conn, user)
            before = conn.execute(text(SNAPSHOT)).one()
            receipts_before = conn.execute(text(RECEIPTS)).all()

        command.upgrade(config, "0006_ocr_processing_quota")
        with admin.connect() as conn:
            assert conn.execute(text(SNAPSHOT)).one() == before
            assert conn.execute(text(RECEIPTS)).all() == receipts_before  # not rewritten
            assert conn.execute(text(NEW_COLUMNS)).scalar_one() == 3
            assert tuple(conn.execute(text(OBJECTS)).one()) == (True, True, True)
            (rls,) = conn.execute(
                text("select relrowsecurity from pg_class where oid = 'ocr_usage_daily'::regclass")
            ).one()
            assert rls is True
            for role in ("anon", "authenticated", "lunti_app_user"):
                granted = conn.execute(
                    text(
                        "select count(*) from information_schema.role_table_grants"
                        " where grantee = :r and table_name = 'ocr_usage_daily'"
                    ),
                    {"r": role},
                ).scalar_one()
                assert granted == 0, f"{role} can reach ocr_usage_daily"
            for fn in ("reserve_ocr_quota", "record_ocr_outcome"):
                executable = conn.execute(
                    text(
                        "select has_function_privilege('authenticated', p.oid, 'execute'),"
                        " has_function_privilege('lunti_app_user', p.oid, 'execute'),"
                        " p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
                        " where n.nspname = 'lunti_private' and p.proname = :f"
                    ),
                    {"f": fn},
                ).one()
                assert tuple(executable) == (False, True, True), fn
        # The previous API keeps working on the new schema.
        with admin.begin() as conn:
            _old_api_receipts(conn, user)

        command.downgrade(config, "0005_recipe_details")
        with admin.connect() as conn:
            assert conn.execute(text(NEW_COLUMNS)).scalar_one() == 0
            assert tuple(conn.execute(text(OBJECTS)).one()) == (False, False, False)
            assert conn.execute(text("select count(*) from receipts")).scalar_one() == 6
            version = conn.execute(text("select version_num from alembic_version")).scalar_one()
            assert version == "0005_recipe_details"

        command.upgrade(config, "head")
        with admin.connect() as conn:
            assert conn.execute(text(NEW_COLUMNS)).scalar_one() == 3
    finally:
        admin.dispose()


@pytest.mark.parametrize(
    "values",
    [
        "'draft', gen_random_uuid(), now(), null",  # a lease only while processing
        "'processing', gen_random_uuid(), null, null",  # attempt and expiry go together
        "'processing', null, now(), null",
        "'draft', null, null, now()",  # purged text: confirmed receipts only
    ],
)
def test_0006_constraints_reject_bad_receipts(admin_engine, make_user, values: str) -> None:  # noqa: ANN001
    user = make_user()
    with pytest.raises(IntegrityError), admin_engine.begin() as conn:
        conn.execute(
            text(
                "insert into receipts (user_id, image_path, ocr_status, ocr_attempt_id,"
                " ocr_lease_expires_at, ocr_text_purged_at)"
                f" values (cast(:u as uuid), :u || '/x.jpg', {values})"
            ),
            {"u": str(user)},
        )


@pytest.mark.parametrize(
    "values",
    [
        "current_date, 'user_scans', null, 1, 0, 0",  # user counter needs a user
        "current_date, 'external_ocr', :u, 1, 0, 0",  # app-wide counter has none
        "current_date, 'other', null, 1, 0, 0",
        "current_date, 'external_ocr', null, 1, 1, 1",  # outcomes can't exceed reservations
        "current_date, 'external_ocr', null, -1, 0, 0",
    ],
)
def test_0006_usage_constraints(admin_engine, make_user, values: str) -> None:  # noqa: ANN001
    user = make_user()
    with pytest.raises(IntegrityError), admin_engine.begin() as conn:
        conn.execute(
            text(
                "insert into ocr_usage_daily (usage_date, counter, user_id, used, succeeded,"
                f" failed) values ({values})"
            ),
            {"u": user},
        )
