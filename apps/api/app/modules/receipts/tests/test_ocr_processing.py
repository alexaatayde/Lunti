"""OCR outside database transactions (Phase 8D.4a), against a real database (needs
TEST_DATABASE_URL). OCR and storage are fakes; nothing calls Google."""

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.db import make_session_factory, scope_session_to_user
from app.modules.receipts import images, service
from app.modules.receipts.ocr import OcrResult, OcrUnavailable
from app.modules.receipts.tests.test_receipts_api import (  # noqa: F401 - fixtures
    API,
    JPEG,
    NOT_A_RECEIPT,
    FakeOcr,
    FakeStorage,
    fakes,
    headers_user_id,
    photo_path,
    receipt_text,
    upload,
    user,
)

pytestmark = pytest.mark.db


def receipt_row(admin_engine: Engine, client_id: str) -> dict | None:
    with admin_engine.connect() as conn:
        row = (
            conn.execute(
                text(
                    "select ocr_status, ocr_attempt_id, ocr_lease_expires_at,"
                    " ocr_lease_expires_at > now() as leased, ocr_raw_text"
                    " from receipts where id = :id"
                ),
                {"id": client_id},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def open_transactions(admin_engine: Engine, database: str) -> int:
    """Other sessions on the test database that are inside a transaction right now."""
    with admin_engine.connect() as conn:
        return conn.execute(
            text(
                "select count(*) from pg_stat_activity where datname = :db"
                " and pid <> pg_backend_pid() and xact_start is not null"
            ),
            {"db": database},
        ).scalar_one()


def insert_processing(
    admin_engine: Engine, user_id: str, client_id: str, *, lease: str | None
) -> None:
    """A receipt left `processing` by an upload whose process died (lease = SQL interval
    relative to now, e.g. '-5 minutes'; None = released)."""
    with admin_engine.begin() as conn:
        conn.execute(
            text(
                "insert into receipts (id, user_id, image_path, ocr_status, ocr_attempt_id,"
                " ocr_lease_expires_at) values (:id, :user, :path, 'processing',"
                " case when cast(:lease as interval) is null then null else gen_random_uuid() end,"
                " now() + cast(:lease as interval))"
            ),
            {
                "id": client_id,
                "user": user_id,
                "path": f"{user_id}/{client_id}.jpg",
                "lease": lease,
            },
        )


# ---------- no transaction or connection held during OCR ----------


def test_ocr_runs_with_no_open_transaction_and_no_pooled_connection(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,
    app_engine: Engine,  # noqa: ANN001, F811
) -> None:
    ocr, _ = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    database = app_engine.url.database
    seen: dict[str, object] = {}
    original = ocr.read

    def read(image: bytes) -> OcrResult:
        seen["checked_out"] = app_engine.pool.checkedout()
        seen["open_transactions"] = open_transactions(admin_engine, database)
        seen["row"] = receipt_row(admin_engine, client_id)
        return original(image)

    ocr.read = read  # type: ignore[method-assign]
    response = upload(db_client, headers, client_id=client_id)
    assert response.status_code == 201, response.text

    assert seen["checked_out"] == 0  # the upload holds no pooled connection while reading
    assert seen["open_transactions"] == 0  # and no transaction anywhere on the database
    row = seen["row"]
    assert isinstance(row, dict)
    # The receipt was committed as processing with a live lease before OCR started.
    assert row["ocr_status"] == "processing" and row["ocr_attempt_id"] is not None
    assert row["leased"] is True and row["ocr_raw_text"] is None

    done = receipt_row(admin_engine, client_id)
    assert done is not None
    assert done["ocr_status"] == "draft" and done["ocr_attempt_id"] is None
    assert done["ocr_lease_expires_at"] is None


def test_slow_ocr_does_not_block_other_users_requests(
    db_client: TestClient,
    fakes,
    make_user,
    auth_header,
    monkeypatch,  # noqa: ANN001, F811
) -> None:
    """With the pool at one connection, a request still completes while an upload waits for
    OCR (before 8D.4a the upload held the only connection for the whole OCR call)."""
    ocr, _ = fakes
    started, release = threading.Event(), threading.Event()
    original = ocr.read

    def read(image: bytes) -> OcrResult:
        started.set()
        assert release.wait(10)
        return original(image)

    ocr.read = read  # type: ignore[method-assign]
    alice, bob = auth_header(make_user()), auth_header(make_user())
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(upload, db_client, alice)
        assert started.wait(10)
        t0 = time.monotonic()
        listed = db_client.get("/api/v1/transactions", headers=bob)
        elapsed = time.monotonic() - t0
        release.set()
        assert pending.result().status_code == 201
    assert listed.status_code == 200 and elapsed < 5


# ---------- duplicates and retries ----------


def test_duplicate_while_reading_waits_then_gets_503_retry_after(
    db_client: TestClient,
    fakes,
    user,
    monkeypatch,  # noqa: ANN001, F811
) -> None:
    ocr, storage = fakes
    headers, _ = user
    monkeypatch.setattr(settings, "ocr_wait_seconds", 0.3)
    monkeypatch.setattr(settings, "ocr_poll_seconds", 0.05)
    client_id = str(uuid.uuid4())
    started, release = threading.Event(), threading.Event()
    original = ocr.read

    def read(image: bytes) -> OcrResult:
        started.set()
        assert release.wait(10)
        return original(image)

    ocr.read = read  # type: ignore[method-assign]
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(upload, db_client, headers, JPEG, client_id)
        assert started.wait(10)
        duplicate = upload(db_client, headers, client_id=client_id)
        release.set()
        assert first.result().status_code == 201

    assert duplicate.status_code == 503
    assert duplicate.headers["Retry-After"] == "5"
    assert duplicate.json()["detail"] == service.UPLOAD_WAIT_DETAIL
    assert ocr.calls == 1 and len(storage.objects) == 1
    again = upload(db_client, headers, client_id=client_id)  # the app's retry
    assert again.status_code == 200 and again.json()["status"] == "draft"


def test_many_concurrent_duplicates_make_one_receipt_and_one_ocr_call(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    ocr, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    original = ocr.read

    def read(image: bytes) -> OcrResult:
        time.sleep(0.3)
        return original(image)

    ocr.read = read  # type: ignore[method-assign]
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(
            pool.map(lambda _: upload(db_client, headers, client_id=client_id), range(6))
        )
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 200, 200, 200, 200, 201]
    assert {r.json()["id"] for r in results} == {client_id}
    assert ocr.calls == 1 and storage.puts == [photo_path(headers, client_id)]
    with admin_engine.connect() as conn:
        count = conn.execute(
            text("select count(*) from receipts where id = :id"), {"id": client_id}
        ).scalar_one()
    assert count == 1


def test_crashed_upload_is_taken_over_after_its_lease_expires(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    ocr, storage = fakes
    headers, _ = user
    user_id = headers_user_id(headers)
    client_id = str(uuid.uuid4())
    path = photo_path(headers, client_id)
    # The earlier process stored the photo, then died before OCR finished.
    insert_processing(admin_engine, user_id, client_id, lease="-1 minute")
    storage.objects[path] = images.sanitize(JPEG).data

    retry = upload(db_client, headers, client_id=client_id)
    assert retry.status_code == 201, retry.text
    assert retry.json()["status"] == "draft" and retry.json()["id"] == client_id
    assert storage.puts == [] and storage.deletes == []  # the stored photo was reused
    assert ocr.calls == 1


def test_takeover_stores_the_photo_if_the_crash_came_before_it(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    _, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    insert_processing(admin_engine, headers_user_id(headers), client_id, lease="-1 minute")
    assert upload(db_client, headers, client_id=client_id).status_code == 201
    assert storage.objects == {photo_path(headers, client_id): images.sanitize(JPEG).data}


def test_takeover_with_a_different_photo_is_refused_and_keeps_the_receipt(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    ocr, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    path = photo_path(headers, client_id)
    insert_processing(admin_engine, headers_user_id(headers), client_id, lease="-1 minute")
    storage.objects[path] = images.sanitize(JPEG).data

    other = upload(db_client, headers, NOT_A_RECEIPT, client_id)
    assert other.status_code == 409
    assert ocr.calls == 0 and storage.objects[path] == images.sanitize(JPEG).data
    row = receipt_row(admin_engine, client_id)
    assert row is not None and row["ocr_status"] == "processing"
    assert row["ocr_attempt_id"] is None  # released: the original photo's retry can resume
    assert upload(db_client, headers, JPEG, client_id).status_code == 201


def test_a_live_lease_is_never_taken_over(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,
    monkeypatch,  # noqa: ANN001, F811
) -> None:
    ocr, storage = fakes
    headers, _ = user
    monkeypatch.setattr(settings, "ocr_wait_seconds", 0.2)
    monkeypatch.setattr(settings, "ocr_poll_seconds", 0.05)
    client_id = str(uuid.uuid4())
    insert_processing(admin_engine, headers_user_id(headers), client_id, lease="5 minutes")
    response = upload(db_client, headers, client_id=client_id)
    assert response.status_code == 503 and response.headers["Retry-After"] == "5"
    assert ocr.calls == 0 and storage.puts == []


def test_retry_after_an_ocr_timeout_counts_again_and_succeeds(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    ocr, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())

    def timeout(image: bytes) -> OcrResult:
        ocr.calls += 1
        raise OcrUnavailable("DeadlineExceeded")

    original = ocr.read
    ocr.read = timeout  # type: ignore[method-assign]
    failed = upload(db_client, headers, client_id=client_id)
    assert failed.status_code == 503 and failed.headers["Retry-After"] == "5"
    assert receipt_row(admin_engine, client_id) is None and storage.objects == {}

    ocr.read = original  # type: ignore[method-assign]
    assert upload(db_client, headers, client_id=client_id).status_code == 201
    assert ocr.calls == 2


# ---------- late results ----------


def _discard_as(app_engine: Engine, user_id: str, client_id: str, storage: FakeStorage) -> None:
    factory = make_session_factory(app_engine)
    with factory() as db, db.begin():
        scope_session_to_user(db, uuid.UUID(user_id))
        service.discard_receipt(
            db,
            CurrentUser(id=uuid.UUID(user_id), email=None, claims={}),
            uuid.UUID(client_id),
            storage,
        )


def test_late_ocr_result_never_resurrects_a_discarded_receipt(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,
    app_engine: Engine,  # noqa: ANN001, F811
) -> None:
    ocr, storage = fakes
    headers, _ = user
    user_id = headers_user_id(headers)
    client_id = str(uuid.uuid4())
    original = ocr.read

    def read(image: bytes) -> OcrResult:
        # The user cancels while the receipt is being read (DELETE /receipts/{id}).
        _discard_as(app_engine, user_id, client_id, storage)
        return original(image)

    ocr.read = read  # type: ignore[method-assign]
    response = upload(db_client, headers, client_id=client_id)
    assert response.status_code == 409
    assert response.json()["detail"] == "This scan was cancelled before it finished reading."
    assert receipt_row(admin_engine, client_id) is None
    assert storage.objects == {}  # photo removed, not left behind by the late result
    assert db_client.get(f"{API}/{client_id}", headers=headers).status_code == 404


def test_late_result_of_a_taken_over_attempt_is_not_written(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,
    monkeypatch,  # noqa: ANN001, F811
) -> None:
    ocr, storage = fakes
    headers, _ = user
    monkeypatch.setattr(settings, "ocr_wait_seconds", 0.2)
    monkeypatch.setattr(settings, "ocr_poll_seconds", 0.05)
    client_id = str(uuid.uuid4())
    other_attempt = str(uuid.uuid4())

    def read(image: bytes) -> OcrResult:
        # This attempt ran past its lease and a retry took the receipt over meanwhile.
        with admin_engine.begin() as conn:
            conn.execute(
                text(
                    "update receipts set ocr_attempt_id = :a,"
                    " ocr_lease_expires_at = now() + interval '5 minutes' where id = :id"
                ),
                {"a": other_attempt, "id": client_id},
            )
        return OcrResult(receipt_text(), 0.9, "google_vision")

    ocr.read = read  # type: ignore[method-assign]
    response = upload(db_client, headers, client_id=client_id)
    assert response.status_code == 503  # waits for the other attempt, which is still busy
    row = receipt_row(admin_engine, client_id)
    assert row is not None and row["ocr_status"] == "processing"
    assert str(row["ocr_attempt_id"]) == other_attempt and row["ocr_raw_text"] is None
    assert len(storage.objects) == 1  # the photo belongs to the other attempt now


# ---------- storage failures ----------


def test_storage_failure_leaves_no_receipt_and_uses_no_quota(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    ocr, storage = fakes
    headers, _ = user
    storage.down = True
    client_id = str(uuid.uuid4())
    response = upload(db_client, headers, client_id=client_id)
    assert response.status_code == 503
    assert receipt_row(admin_engine, client_id) is None and ocr.calls == 0
    with admin_engine.connect() as conn:
        used = conn.execute(
            text(
                "select coalesce(sum(used), 0) from ocr_usage_daily"
                " where user_id = cast(:u as uuid)"
            ),
            {"u": headers_user_id(headers)},
        ).scalar_one()
    assert used == 0


def test_storage_failure_during_takeover_releases_nothing_it_does_not_own(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    ocr, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    insert_processing(admin_engine, headers_user_id(headers), client_id, lease="-1 minute")
    storage.get_down = True
    assert upload(db_client, headers, client_id=client_id).status_code == 503
    assert ocr.calls == 0
    # The attempt undid its own claim: the receipt is gone and the retry starts over.
    assert receipt_row(admin_engine, client_id) is None
    storage.get_down = False
    assert upload(db_client, headers, client_id=client_id).status_code == 201


def test_confirm_refuses_a_receipt_still_being_read(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    headers, cats = user
    client_id = str(uuid.uuid4())
    insert_processing(admin_engine, headers_user_id(headers), client_id, lease="5 minutes")
    from app.modules.receipts.tests.test_receipts_api import confirm_body

    response = db_client.post(
        f"{API}/{client_id}/confirm", headers=headers, json=confirm_body(cats)
    )
    assert response.status_code == 409
    assert response.json()["detail"] == service.UPLOAD_WAIT_DETAIL


def test_processing_receipt_reads_back_without_a_draft(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    headers, _ = user
    client_id = str(uuid.uuid4())
    insert_processing(admin_engine, headers_user_id(headers), client_id, lease="5 minutes")
    body = db_client.get(f"{API}/{client_id}", headers=headers).json()
    assert body["status"] == "processing" and body["draft"] is None
    assert body["image_url"] is None
    assert db_client.delete(f"{API}/{client_id}", headers=headers).status_code == 204


def test_fake_storage_type() -> None:  # keeps the import used for type checkers
    assert FakeStorage and FakeOcr


def test_stored_text_is_redacted_and_the_draft_is_unchanged(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,
) -> None:
    ocr, _ = fakes
    headers, _ = user
    paid_by_card = receipt_text() + (
        "VISA 4111 1111 1111 1111   140.00\nAPPROVAL CODE: 0A12BC\nSOLD TO: Juan Dela Cruz\n"
    )
    ocr.read = lambda image: OcrResult(paid_by_card, 0.9, "google_vision")  # type: ignore[method-assign]
    client_id = str(uuid.uuid4())
    body = upload(db_client, headers, client_id=client_id).json()
    assert body["status"] == "draft" and body["draft"]["total"] == "140.00"
    assert [i["line_total"] for i in body["draft"]["items"]] == ["37.50", "112.00"]
    stored = receipt_row(admin_engine, client_id)["ocr_raw_text"]  # type: ignore[index]
    for secret in ("4111 1111 1111 1111", "0A12BC", "Juan Dela Cruz"):
        assert secret not in stored and secret not in str(body)
    assert "VISA **** 1111   140.00" in stored


def test_a_request_never_keeps_rerunning_ocr_when_leases_keep_being_taken(
    db_client: TestClient,
    fakes,
    user,
    admin_engine: Engine,
    monkeypatch,  # noqa: ANN001
) -> None:
    ocr, _ = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())

    def read(image: bytes) -> OcrResult:
        ocr.calls += 1
        with admin_engine.begin() as conn:  # every attempt is taken over, then expires
            conn.execute(
                text(
                    "update receipts set ocr_attempt_id = gen_random_uuid(),"
                    " ocr_lease_expires_at = now() - interval '1 second' where id = :id"
                ),
                {"id": client_id},
            )
        return OcrResult(receipt_text(), 0.9, "google_vision")

    ocr.read = read  # type: ignore[method-assign]
    response = upload(db_client, headers, client_id=client_id)
    assert response.status_code == 503 and response.headers["Retry-After"] == "5"
    assert ocr.calls == service.MAX_LOST_CLAIMS
