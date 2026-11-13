"""D5: deleting a scanned transaction removes its receipt and photo; abandoned drafts and
orphaned photos are cleaned up (needs TEST_DATABASE_URL). OCR and storage are fakes."""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.core.auth import CurrentUser
from app.core.db import make_session_factory, scope_session_to_user
from app.jobs.receipt_cleanup import CLEANUP_LOCK, run_receipt_cleanup
from app.main import app
from app.modules.receipts import cleanup
from app.modules.receipts.ocr import get_ocr
from app.modules.receipts.storage import StorageUnavailable, StoredObject, get_storage
from app.modules.receipts.tests.test_receipts_api import (
    UNREADABLE,
    FakeOcr,
    confirm_body,
    upload,
)

pytestmark = pytest.mark.db

TXNS = "/api/v1/transactions"
GRACE = timedelta(hours=24)
RETENTION = timedelta(days=7)


class TimedStorage:
    """FakeStorage plus the server-side timestamps and listing the cleanup relies on."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.created: dict[str, datetime] = {}
        self.down = False
        self.list_down = False
        self.deleted: list[str] = []

    def put(self, path: str, data: bytes, content_type: str) -> None:
        if self.down:
            raise StorageUnavailable
        assert path not in self.objects
        self.objects[path] = data
        self.created[path] = datetime.now(UTC)

    def delete(self, path: str) -> None:
        if self.down:
            raise StorageUnavailable
        self.deleted.append(path)
        self.objects.pop(path, None)  # missing: fine, like the real adapters
        self.created.pop(path, None)

    def signed_url(self, path: str) -> str | None:
        return None

    def list_objects(self) -> Iterator[StoredObject]:
        if self.list_down:
            raise StorageUnavailable
        for path in list(self.objects):
            yield StoredObject(path, self.created[path])

    def age(self, path: str, by: timedelta) -> None:
        self.created[path] = datetime.now(UTC) - by

    def add(self, path: str, age: timedelta) -> None:
        self.objects[path] = b"x"
        self.created[path] = datetime.now(UTC) - age


@pytest.fixture
def storage(db_client: TestClient) -> TimedStorage:
    ocr, store = FakeOcr(), TimedStorage()
    app.dependency_overrides[get_ocr] = lambda: ocr
    app.dependency_overrides[get_storage] = lambda: store
    return store


@pytest.fixture
def user(db_client: TestClient, make_user, auth_header):  # noqa: ANN001, ANN201
    user_id = make_user()
    headers = auth_header(user_id)
    cats = {c["name"]: c["id"] for c in db_client.get("/api/v1/categories", headers=headers).json()}
    return user_id, headers, cats


@pytest.fixture
def factory(app_engine: Engine):  # noqa: ANN201
    return make_session_factory(app_engine)


def scan_and_save(client: TestClient, headers, cats) -> tuple[str, str]:  # noqa: ANN001
    """A confirmed scan: returns (receipt id, transaction id)."""
    receipt = upload(client, headers).json()
    saved = client.post(
        f"/api/v1/receipts/{receipt['id']}/confirm", headers=headers, json=confirm_body(cats)
    )
    assert saved.status_code == 200, saved.text
    return receipt["id"], saved.json()["id"]


def receipt_rows(admin: Engine, user_id: uuid.UUID) -> list[tuple[str, str]]:
    with admin.connect() as conn:
        return [
            (str(r[0]), r[1])
            for r in conn.execute(
                text("select id, ocr_status from receipts where user_id = :u"), {"u": user_id}
            )
        ]


def backdate(admin: Engine, receipt_id: str, by: timedelta) -> None:
    with admin.begin() as conn:
        conn.execute(
            text("update receipts set created_at = now() - :by where id = :id"),
            {"by": by, "id": receipt_id},
        )


def count(admin: Engine, sql: str, user_id: uuid.UUID) -> int:
    with admin.connect() as conn:
        return conn.execute(text(sql), {"u": user_id}).scalar_one()


# ---------- deleting a scanned transaction ----------


def test_deleting_a_scanned_transaction_removes_its_receipt_and_photo(
    db_client: TestClient,
    storage: TimedStorage,
    user,
    admin_engine: Engine,  # noqa: ANN001
) -> None:
    user_id, headers, cats = user
    db_client.post(
        "/api/v1/budgets",
        headers=headers,
        json={"category_id": cats["Groceries"], "period_type": "monthly", "limit_amount": "150.00"},
    )
    receipt_id, txn_id = scan_and_save(db_client, headers, cats)
    path = next(iter(storage.objects))
    spent = lambda: db_client.get("/api/v1/budgets/status", headers=headers).json()[0]["spent"]  # noqa: E731
    assert spent() == "140.00"
    assert (
        count(admin_engine, "select count(*) from purchase_patterns where user_id=:u", user_id) == 2
    )

    # Confirm one pantry amount by hand; estimates go with the purchase, confirmed ones stay.
    items = db_client.get("/api/v1/pantry", headers=headers).json()["items"]
    eggs = next(i for i in items if i["name"].lower().startswith("eggs"))
    db_client.patch(f"/api/v1/pantry/{eggs['id']}", headers=headers, json={"confirmed": True})

    assert db_client.delete(f"{TXNS}/{txn_id}", headers=headers).status_code == 204

    assert receipt_rows(admin_engine, user_id) == []
    assert db_client.get(f"/api/v1/receipts/{receipt_id}", headers=headers).status_code == 404
    assert path not in storage.objects and storage.deleted == [path]
    assert spent() == "0.00"  # budget recalculated
    assert (
        count(admin_engine, "select count(*) from purchase_patterns where user_id=:u", user_id) == 0
    )
    left = {
        i["name"].lower(): (i["quantity"], i["confirmed"])
        for i in db_client.get("/api/v1/pantry", headers=headers).json()["items"]
    }
    assert left[eggs["name"].lower()] == (eggs["quantity"], True)
    assert all(q == "0.000" for name, (q, c) in left.items() if not c)


def test_a_manual_delete_never_needs_storage(
    db_client: TestClient,
    user,
    monkeypatch: pytest.MonkeyPatch,  # noqa: ANN001
) -> None:
    _, headers, cats = user

    def unavailable() -> None:
        raise AssertionError("storage must not be touched for a manual transaction")

    app.dependency_overrides[get_storage] = unavailable
    body = {
        "amount": "12.00",
        "category_id": cats["Groceries"],
        "occurred_at": datetime.now(UTC).isoformat(),
    }
    txn = db_client.post(TXNS, headers=headers, json=body).json()
    assert db_client.delete(f"{TXNS}/{txn['id']}", headers=headers).status_code == 204


def test_a_storage_outage_never_blocks_the_delete_and_the_photo_is_cleaned_up_later(
    db_client: TestClient,
    storage: TimedStorage,
    user,
    admin_engine: Engine,
    factory,  # noqa: ANN001
) -> None:
    user_id, headers, cats = user
    _, txn_id = scan_and_save(db_client, headers, cats)
    path = next(iter(storage.objects))
    storage.down = True

    assert db_client.delete(f"{TXNS}/{txn_id}", headers=headers).status_code == 204
    assert receipt_rows(admin_engine, user_id) == []  # committed regardless
    assert count(admin_engine, "select count(*) from transactions where user_id=:u", user_id) == 0
    assert path in storage.objects  # left behind, for now

    storage.down = False
    first = run_receipt_cleanup(
        factory, lambda: storage, orphan_grace=GRACE, draft_retention=RETENTION
    )
    assert first["orphans_deleted"] == 0 and path in storage.objects  # still in its grace period

    storage.age(path, GRACE + timedelta(minutes=1))
    second = run_receipt_cleanup(
        factory, lambda: storage, orphan_grace=GRACE, draft_retention=RETENTION
    )
    assert second["orphans_deleted"] == 1 and path not in storage.objects
    again = run_receipt_cleanup(
        factory, lambda: storage, orphan_grace=GRACE, draft_retention=RETENTION
    )
    assert again["orphans_deleted"] == 0  # idempotent


def test_an_already_missing_photo_is_fine(
    db_client: TestClient,
    storage: TimedStorage,
    user,
    admin_engine: Engine,  # noqa: ANN001
) -> None:
    user_id, headers, cats = user
    _, txn_id = scan_and_save(db_client, headers, cats)
    storage.objects.clear()
    assert db_client.delete(f"{TXNS}/{txn_id}", headers=headers).status_code == 204
    assert receipt_rows(admin_engine, user_id) == []


def test_users_cannot_touch_each_others_receipts_or_photos(
    db_client: TestClient,
    storage: TimedStorage,
    user,
    make_user,
    auth_header,
    as_user,
    admin_engine: Engine,
    factory,  # noqa: ANN001, E501
) -> None:
    owner_id, owner, cats = user
    receipt_id, txn_id = scan_and_save(db_client, owner, cats)
    path = next(iter(storage.objects))
    intruder_id = make_user()
    intruder = auth_header(intruder_id)

    assert db_client.delete(f"{TXNS}/{txn_id}", headers=intruder).status_code == 404
    # Even called directly, the intruder's RLS-scoped session can't reach the owner's row.
    db = as_user(intruder_id)
    who = CurrentUser(id=intruder_id, email=None, claims={})
    assert cleanup.delete_for_transaction(db, who, uuid.UUID(receipt_id), lambda: storage) is False
    db.commit()

    # An old photo that a receipt still references is kept by the cleanup.
    storage.age(path, timedelta(days=60))
    backdate(admin_engine, receipt_id, timedelta(days=60))
    run_receipt_cleanup(factory, lambda: storage, orphan_grace=GRACE, draft_retention=RETENTION)
    assert receipt_rows(admin_engine, owner_id) == [(receipt_id, "confirmed")]
    assert path in storage.objects


# ---------- orphaned photos ----------


def test_orphan_grace_period_boundaries_and_namespace(
    db_client: TestClient,
    storage: TimedStorage,
    factory,  # noqa: ANN001
) -> None:
    u = uuid.uuid4()
    old, young = f"{u}/{uuid.uuid4()}.jpg", f"{u}/{uuid.uuid4()}.png"
    storage.add(old, GRACE + timedelta(minutes=1))
    storage.add(young, GRACE - timedelta(minutes=1))  # an upload may still be committing
    for foreign in (
        "README.txt",
        f"{u}/notes.jpg",
        f"{u}/{uuid.uuid4()}.pdf",
        f"{u}/x/{uuid.uuid4()}.jpg",
    ):
        storage.add(foreign, timedelta(days=90))  # not a name receipts create

    result = cleanup.delete_orphan_images(factory, lambda: storage, GRACE)

    assert old not in storage.objects and young in storage.objects
    assert result["orphans_deleted"] == 1 and result["ignored_names"] == 4
    assert all(f in storage.objects for f in ("README.txt", f"{u}/notes.jpg"))


def test_a_listing_outage_postpones_the_orphan_pass_without_changes(
    db_client: TestClient,
    storage: TimedStorage,
    factory,  # noqa: ANN001
) -> None:
    path = f"{uuid.uuid4()}/{uuid.uuid4()}.jpg"
    storage.add(path, timedelta(days=3))
    storage.list_down = True
    result = run_receipt_cleanup(
        factory, lambda: storage, orphan_grace=GRACE, draft_retention=RETENTION
    )
    assert result["orphan_pass_postponed"] == 1 and path in storage.objects


def test_a_failed_photo_delete_is_retried_on_the_next_run(
    db_client: TestClient,
    storage: TimedStorage,
    factory,  # noqa: ANN001
) -> None:
    path = f"{uuid.uuid4()}/{uuid.uuid4()}.jpg"
    storage.add(path, timedelta(days=3))
    real_delete = storage.delete
    storage.delete = lambda p: (_ for _ in ()).throw(StorageUnavailable())  # type: ignore[method-assign]
    assert cleanup.delete_orphan_images(factory, lambda: storage, GRACE)["orphan_failures"] == 1
    storage.delete = real_delete  # type: ignore[method-assign]
    assert cleanup.delete_orphan_images(factory, lambda: storage, GRACE)["orphans_deleted"] == 1


# ---------- abandoned drafts ----------


def test_abandoned_drafts_are_deleted_after_the_retention_period_only(
    db_client: TestClient,
    storage: TimedStorage,
    user,
    admin_engine: Engine,
    factory,  # noqa: ANN001
) -> None:
    user_id, headers, cats = user
    old_draft = upload(db_client, headers).json()["id"]
    old_failed = upload(db_client, headers, UNREADABLE).json()["id"]
    recent_draft = upload(db_client, headers).json()["id"]
    saved_receipt, _ = scan_and_save(db_client, headers, cats)
    paths = {p.split("/")[1].split(".")[0]: p for p in storage.objects}
    backdate(admin_engine, old_draft, RETENTION + timedelta(hours=1))
    backdate(admin_engine, old_failed, RETENTION + timedelta(hours=1))
    backdate(admin_engine, recent_draft, RETENTION - timedelta(hours=1))
    backdate(admin_engine, saved_receipt, RETENTION * 10)  # confirmed: retained

    result = cleanup.delete_stale_drafts(factory, lambda: storage, RETENTION)

    assert result["stale_drafts_deleted"] == 2
    assert sorted(receipt_rows(admin_engine, user_id)) == sorted(
        [(recent_draft, "draft"), (saved_receipt, "confirmed")]
    )
    assert paths[old_draft] not in storage.objects and paths[old_failed] not in storage.objects
    assert paths[recent_draft] in storage.objects and paths[saved_receipt] in storage.objects
    assert (
        cleanup.delete_stale_drafts(factory, lambda: storage, RETENTION)["stale_drafts_deleted"]
        == 0
    )


def test_a_draft_being_confirmed_is_never_deleted(
    db_client: TestClient,
    storage: TimedStorage,
    user,
    admin_engine: Engine,
    factory,
    app_engine: Engine,  # noqa: ANN001, E501
) -> None:
    user_id, headers, cats = user
    draft = upload(db_client, headers).json()["id"]
    backdate(admin_engine, draft, RETENTION + timedelta(hours=1))

    # A confirm in progress holds the row lock (confirm_receipt locks FOR UPDATE).
    holder = make_session_factory(app_engine)()
    holder.begin()
    scope_session_to_user(holder, user_id)
    holder.execute(text("select id from receipts where id = :id for update"), {"id": draft})
    try:
        result = cleanup.delete_stale_drafts(factory, lambda: storage, RETENTION)
        assert result == {"stale_drafts_deleted": 0, "stale_drafts_skipped": 1}
    finally:
        holder.rollback()
        holder.close()

    # The confirm then completes; the cleanup leaves a confirmed receipt alone.
    saved = db_client.post(
        f"/api/v1/receipts/{draft}/confirm", headers=headers, json=confirm_body(cats)
    )
    assert saved.status_code == 200
    assert (
        cleanup.delete_stale_drafts(factory, lambda: storage, RETENTION)["stale_drafts_deleted"]
        == 0
    )
    assert receipt_rows(admin_engine, user_id) == [(draft, "confirmed")]


def test_only_one_cleanup_runs_at_a_time(
    db_client: TestClient,
    storage: TimedStorage,
    factory,
    app_engine: Engine,  # noqa: ANN001
) -> None:
    with app_engine.connect() as conn:
        assert conn.execute(
            text("select pg_try_advisory_lock(hashtext(:k))"), {"k": CLEANUP_LOCK}
        ).scalar_one()
        try:
            result = run_receipt_cleanup(
                factory, lambda: storage, orphan_grace=GRACE, draft_retention=RETENTION
            )
            assert result == {"skipped": 1}
        finally:
            conn.execute(text("select pg_advisory_unlock(hashtext(:k))"), {"k": CLEANUP_LOCK})
            conn.commit()
    assert (
        run_receipt_cleanup(
            factory, lambda: storage, orphan_grace=GRACE, draft_retention=RETENTION
        )["skipped"]
        == 0
    )
