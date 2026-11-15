"""Phase 8D.4a cleanup passes: abandoned uploads, recognised-text retention and old usage
counters (needs TEST_DATABASE_URL). OCR and storage are fakes."""

import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.core.config import settings
from app.jobs.receipt_cleanup import run_receipt_cleanup
from app.modules.receipts import cleanup
from app.modules.receipts.tests.test_receipt_cleanup import (  # noqa: F401 - fixtures
    TimedStorage,
    factory,
    receipt_rows,
    scan_and_save,
    storage,
    user,
)
from app.modules.receipts.tests.test_receipts_api import API, upload

pytestmark = pytest.mark.db

DAY = timedelta(days=1)


def set_times(admin: Engine, receipt_id: str, **columns: str) -> None:
    """Backdate columns (SQL expressions) without the updated_at trigger interfering."""
    assignments = ", ".join(f"{name} = {expr}" for name, expr in columns.items())
    with admin.begin() as conn:
        conn.execute(text("set local session_replication_role = replica"))
        conn.execute(text(f"update receipts set {assignments} where id = :id"), {"id": receipt_id})


def receipt(admin: Engine, receipt_id: str) -> dict | None:
    with admin.connect() as conn:
        row = (
            conn.execute(
                text(
                    "select ocr_status, ocr_raw_text, ocr_text_purged_at, confirmed_at"
                    " from receipts where id = :id"
                ),
                {"id": receipt_id},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


# ---------- raw-text retention ----------


def test_raw_text_of_old_confirmed_receipts_is_purged_and_nothing_else(
    db_client: TestClient,
    storage: TimedStorage,
    user,
    admin_engine: Engine,
    factory,  # noqa: ANN001, F811
) -> None:
    user_id, headers, cats = user
    old, old_txn = scan_and_save(db_client, headers, cats)
    recent, _ = scan_and_save(db_client, headers, cats)
    draft = upload(db_client, headers).json()["id"]
    set_times(admin_engine, old, confirmed_at="now() - interval '31 days'")
    set_times(admin_engine, recent, confirmed_at="now() - interval '29 days'")
    set_times(admin_engine, draft, created_at="now() - interval '60 days'")  # a draft: kept
    photos = dict(storage.objects)

    assert cleanup.purge_raw_text(factory, 30 * DAY) == {"raw_text_purged": 1}

    purged = receipt(admin_engine, old)
    assert purged is not None and purged["ocr_raw_text"] is None
    assert purged["ocr_text_purged_at"] is not None and purged["ocr_status"] == "confirmed"
    assert receipt(admin_engine, recent)["ocr_raw_text"]  # type: ignore[index]
    assert receipt(admin_engine, draft)["ocr_raw_text"]  # type: ignore[index]
    assert storage.objects == photos  # photos untouched
    # The structured record stays: the transaction and its items are unchanged.
    detail = db_client.get(f"/api/v1/transactions/{old_txn}", headers=headers).json()
    assert detail["amount"] == "140.00" and len(detail["items"]) == 2
    read_back = db_client.get(f"{API}/{old}", headers=headers).json()
    assert read_back["status"] == "confirmed" and read_back["transaction_id"] == old_txn
    assert read_back["draft"] is None
    # Running again changes nothing.
    assert cleanup.purge_raw_text(factory, 30 * DAY) == {"raw_text_purged": 0}


def test_retention_is_off_unless_configured(
    db_client: TestClient,
    storage: TimedStorage,
    user,
    admin_engine: Engine,
    factory,
    monkeypatch,  # noqa: ANN001, F811
) -> None:
    _, headers, cats = user
    old, _ = scan_and_save(db_client, headers, cats)
    set_times(admin_engine, old, confirmed_at="now() - interval '3650 days'")
    monkeypatch.setattr(settings, "receipt_raw_text_retention_days", 0)
    counts = run_receipt_cleanup(factory, lambda: storage)
    assert "raw_text_purged" not in counts
    assert receipt(admin_engine, old)["ocr_raw_text"]  # type: ignore[index]

    monkeypatch.setattr(settings, "receipt_raw_text_retention_days", 30)
    assert run_receipt_cleanup(factory, lambda: storage)["raw_text_purged"] >= 1
    assert receipt(admin_engine, old)["ocr_raw_text"] is None  # type: ignore[index]


def test_purged_receipt_cannot_regain_text(admin_engine: Engine, user, db_client, storage) -> None:  # noqa: ANN001, F811
    _, headers, cats = user
    old, _ = scan_and_save(db_client, headers, cats)
    set_times(admin_engine, old, ocr_raw_text="null", ocr_text_purged_at="now()")
    with pytest.raises(Exception, match="ck_receipts_ocr_text_purged"):
        set_times(admin_engine, old, ocr_raw_text="'card 4111'")


def test_repeated_confirm_after_purge_still_returns_the_transaction(
    db_client: TestClient,
    storage: TimedStorage,
    user,
    admin_engine: Engine,
    factory,  # noqa: ANN001, F811
) -> None:
    _, headers, cats = user
    rid, txn = scan_and_save(db_client, headers, cats)
    set_times(admin_engine, rid, confirmed_at="now() - interval '40 days'")
    cleanup.purge_raw_text(factory, 30 * DAY)
    from app.modules.receipts.tests.test_receipts_api import confirm_body

    again = db_client.post(f"{API}/{rid}/confirm", headers=headers, json=confirm_body(cats))
    assert again.status_code == 200 and again.json()["id"] == txn


# ---------- abandoned uploads ----------


def test_abandoned_processing_receipts_are_removed_but_live_ones_are_not(
    db_client: TestClient,
    storage: TimedStorage,
    user,
    admin_engine: Engine,
    factory,  # noqa: ANN001, F811
) -> None:
    user_id, _, _ = user
    ids = {name: str(uuid.uuid4()) for name in ("dead", "fresh_dead", "live", "released")}
    with admin_engine.begin() as conn:
        conn.execute(text("set local session_replication_role = replica"))
        for name, lease, updated in (
            ("dead", "now() - interval '2 hours'", "now() - interval '2 hours'"),
            ("fresh_dead", "now() - interval '1 minute'", "now() - interval '2 minutes'"),
            ("live", "now() + interval '1 minute'", "now() - interval '2 hours'"),
            ("released", None, "now() - interval '3 hours'"),
        ):
            rid = ids[name]
            storage.add(f"{user_id}/{rid}.jpg", timedelta(hours=3))
            conn.execute(
                text(
                    "insert into receipts (id, user_id, image_path, ocr_status, ocr_attempt_id,"
                    f" ocr_lease_expires_at, updated_at) values (:id, :u, :p, 'processing',"
                    f" {'gen_random_uuid()' if lease else 'null'}, {lease or 'null'}, {updated})"
                ),
                {"id": rid, "u": user_id, "p": f"{user_id}/{rid}.jpg"},
            )

    result = cleanup.delete_abandoned_processing(factory, lambda: storage, timedelta(minutes=60))
    assert result["abandoned_processing_deleted"] == 2
    left = {rid for rid, _ in receipt_rows(admin_engine, user_id)}
    assert left == {ids["fresh_dead"], ids["live"]}
    assert f"{user_id}/{ids['dead']}.jpg" not in storage.objects
    assert f"{user_id}/{ids['live']}.jpg" in storage.objects


def test_stale_draft_pass_never_deletes_a_receipt_under_a_live_lease(
    db_client: TestClient,
    storage: TimedStorage,
    user,
    admin_engine: Engine,
    factory,  # noqa: ANN001, F811
) -> None:
    user_id, _, _ = user
    rid = str(uuid.uuid4())
    with admin_engine.begin() as conn:
        conn.execute(
            text(
                "insert into receipts (id, user_id, image_path, ocr_status, ocr_attempt_id,"
                " ocr_lease_expires_at, created_at) values (:id, :u, :p, 'processing',"
                " gen_random_uuid(), now() + interval '1 minute', now() - interval '30 days')"
            ),
            {"id": rid, "u": user_id, "p": f"{user_id}/{rid}.jpg"},
        )
    assert (
        cleanup.delete_stale_drafts(factory, lambda: storage, 7 * DAY)["stale_drafts_deleted"] == 0
    )
    assert rid in {r for r, _ in receipt_rows(admin_engine, user_id)}


# ---------- usage counters ----------


def test_old_per_user_counters_are_pruned_and_app_wide_ones_kept(
    admin_engine: Engine,
    make_user,
    factory,  # noqa: ANN001, F811
) -> None:
    user_id = make_user()
    today = date(2039, 6, 30)  # before the quota tests' days (2040+)
    with admin_engine.begin() as conn:
        for days_ago in (0, 31, 32):
            day = today - timedelta(days=days_ago)
            conn.execute(
                text(
                    "insert into ocr_usage_daily (usage_date, counter, user_id, used)"
                    " values (:d, 'user_scans', :u, 1), (:d, 'external_ocr', null, 1)"
                ),
                {"d": day, "u": user_id},
            )
    pruned = cleanup.prune_usage_counters(factory, 31, today=today)
    assert pruned["usage_counters_pruned"] >= 1  # other tests' old rows may go too
    with admin_engine.connect() as conn:
        mine = (
            conn.execute(
                text("select usage_date from ocr_usage_daily where user_id = :u order by 1"),
                {"u": user_id},
            )
            .scalars()
            .all()
        )
        app_wide = conn.execute(
            text(
                "select count(*) from ocr_usage_daily where counter = 'external_ocr'"
                " and usage_date in (:a, :b, :c)"
            ),
            {"a": today, "b": today - timedelta(days=31), "c": today - timedelta(days=32)},
        ).scalar_one()
    assert mine == [today - timedelta(days=31), today]
    assert app_wide == 3
