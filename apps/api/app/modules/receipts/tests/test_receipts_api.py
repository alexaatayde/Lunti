"""/receipts against a real database (needs TEST_DATABASE_URL). OCR and storage are fakes."""

import threading
import time
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.main import app
from app.modules.expenses import periods
from app.modules.receipts import images
from app.modules.receipts.ocr import OcrResult, OcrUnavailable, get_ocr
from app.modules.receipts.storage import (
    ObjectExists,
    StorageUnavailable,
    check_path,
    get_storage,
)
from app.modules.receipts.tests.imaging import BLURRY, NOTES, RECEIPT, kind_of, near, photo

pytestmark = pytest.mark.db

API = "/api/v1/receipts"
# Real photos (uploads are decoded and re-encoded); FakeOcr tells them apart by colour.
JPEG = photo(RECEIPT)
UNREADABLE = photo(BLURRY)
NOT_A_RECEIPT = photo(NOTES)


def today_line() -> str:
    return periods.local_today().strftime("%m/%d/%Y") + " 10:42"


def receipt_text() -> str:
    return (
        "ZZ TEST MART\n"
        f"{today_line()}\n"
        "BEAR BRAND 33G\n3 @ 12.50   37.50\n"
        "EGGS LARGE   112.00\n"
        "SUBTOTAL   149.50\n"
        "LESS SC DISC   -9.50\n"
        "AMOUNT DUE   140.00\n"
        "VAT AMOUNT   10.00\n"
    )


class FakeOcr:
    name = "google_vision"

    def __init__(self) -> None:
        self.calls = 0
        self.down = False
        self.images: list[bytes] = []  # what OCR was given (always the sanitised photo)

    def read(self, image: bytes) -> OcrResult:
        self.calls += 1
        self.images.append(image)
        if self.down:
            raise OcrUnavailable
        colour = kind_of(image)
        if near(colour, BLURRY):
            return OcrResult("", None, "google_vision")
        if near(colour, NOTES):
            return OcrResult("Meeting notes\nCall the landlord", 0.97, "google_vision")
        return OcrResult(receipt_text(), 0.9, "google_vision")


class FakeStorage:
    """Behaves like the real adapters: refuses other object names, never overwrites (put
    raises ObjectExists), and a missing object reads as None / deletes as a no-op."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.content_types: dict[str, str] = {}
        self.down = False
        self.get_down = False
        self.delete_down = False
        self.puts: list[str] = []
        self.deletes: list[str] = []
        # Write the object, then fail the request (a lost response / timeout after upload).
        self.fail_after_put = False

    def put(self, path: str, data: bytes, content_type: str) -> None:
        check_path(path)
        if self.down:
            raise StorageUnavailable
        self.puts.append(path)
        if path in self.objects:
            raise ObjectExists
        self.objects[path] = data
        self.content_types[path] = content_type
        if self.fail_after_put:
            raise StorageUnavailable

    def get(self, path: str) -> bytes | None:
        check_path(path)
        if self.down or self.get_down:
            raise StorageUnavailable
        return self.objects.get(path)

    def delete(self, path: str) -> None:
        check_path(path)
        if self.down or self.delete_down:
            raise StorageUnavailable
        self.deletes.append(path)
        self.objects.pop(path, None)
        self.content_types.pop(path, None)

    def signed_url(self, path: str) -> str | None:
        check_path(path)
        return f"https://storage.test/signed/{path}"


@pytest.fixture
def fakes(db_client: TestClient) -> Iterator[tuple[FakeOcr, FakeStorage]]:
    ocr, storage = FakeOcr(), FakeStorage()
    app.dependency_overrides[get_ocr] = lambda: ocr
    app.dependency_overrides[get_storage] = lambda: storage
    yield ocr, storage


@pytest.fixture
def user(db_client: TestClient, make_user, auth_header):  # noqa: ANN001, ANN201
    headers = auth_header(make_user())
    cats = {c["name"]: c["id"] for c in db_client.get("/api/v1/categories", headers=headers).json()}
    return headers, cats


def upload(client: TestClient, headers, image: bytes = JPEG, client_id: str | None = None):  # noqa: ANN001, ANN201
    return client.post(
        API,
        headers=headers,
        data={"client_id": client_id or str(uuid.uuid4())},
        files={"image": ("receipt.jpg", image, "image/jpeg")},
    )


def confirm_body(cats: dict[str, str], **overrides) -> dict:  # noqa: ANN003
    body = {
        "category_id": cats["Groceries"],
        "occurred_at": datetime.now(periods.app_tz()).replace(microsecond=0).isoformat(),
        "merchant": "ZZ Test Mart",
        "total": "140.00",
        "discount": "9.50",
        "items": [
            {"name": "Bear Brand 33G", "quantity": "3", "unit_price": "12.50"},
            {"name": "Eggs large", "quantity": "1", "unit_price": "112.00"},
        ],
    }
    body.update(overrides)
    return body


# ---------- upload ----------


def test_upload_returns_a_draft_and_writes_no_transaction(
    db_client: TestClient,
    fakes,
    user,  # noqa: ANN001
) -> None:
    ocr, storage = fakes
    headers, cats = user
    response = upload(db_client, headers)
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["status"] == "draft" and body["simulated"] is False
    assert body["ocr_engine"] == "google_vision"
    draft = body["draft"]
    assert draft["merchant"] == "ZZ TEST MART"
    assert draft["total"] == "140.00" and draft["items_total"] == "140.00"
    assert draft["discount"] == "9.50" and draft["vat"] == "10.00"
    assert [i["line_total"] for i in draft["items"]] == ["37.50", "112.00"]
    assert body["confidence"] == {"store": 86, "items": 90, "total": 89}
    assert body["suggested_category"]["id"] == cats["Groceries"]
    assert body["image_url"].startswith("https://storage.test/signed/")
    assert body["transaction_id"] is None and body["possible_duplicate"] is None

    # The image is stored under the owner's folder; nothing financial was written.
    user_id = headers_user_id(headers)
    assert list(storage.objects) == [f"{user_id}/{body['id']}.jpg"]
    assert db_client.get("/api/v1/transactions", headers=headers).json()["items"] == []
    assert db_client.get(f"{API}/{body['id']}", headers=headers).json() == body


def headers_user_id(headers: dict[str, str]) -> str:
    import jwt

    token = headers["Authorization"].split()[1]
    return jwt.decode(token, options={"verify_signature": False})["sub"]


def test_repeated_upload_returns_the_same_receipt(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    ocr, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    first = upload(db_client, headers, client_id=client_id)
    again = upload(db_client, headers, client_id=client_id)
    assert first.status_code == 201 and again.status_code == 200
    assert again.json()["id"] == first.json()["id"] == client_id
    assert ocr.calls == 1 and len(storage.objects) == 1


def test_unreadable_and_non_receipt_images_fail_without_a_transaction(
    db_client: TestClient,
    fakes,
    user,  # noqa: ANN001
) -> None:
    headers, _ = user
    blurry = upload(db_client, headers, UNREADABLE)
    notes = upload(db_client, headers, NOT_A_RECEIPT)
    assert blurry.status_code == notes.status_code == 201
    assert blurry.json()["status"] == "failed" and blurry.json()["failure_reason"] == "unreadable"
    assert notes.json()["failure_reason"] == "no_amounts" and notes.json()["draft"] is None
    assert db_client.get("/api/v1/transactions", headers=headers).json()["items"] == []


def test_low_ocr_confidence_fails(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    ocr, _ = fakes
    headers, _ = user
    ocr.read = lambda image: OcrResult(receipt_text(), 0.3, "google_vision")  # type: ignore[method-assign]
    assert upload(db_client, headers).json()["status"] == "failed"


def test_ocr_outage_is_retryable_and_leaves_nothing(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    ocr, storage = fakes
    headers, _ = user
    ocr.down = True
    client_id = str(uuid.uuid4())
    response = upload(db_client, headers, client_id=client_id)
    assert response.status_code == 503
    assert storage.objects == {}  # the stored image was removed again
    assert db_client.get(f"{API}/{client_id}", headers=headers).status_code == 404

    ocr.down = False  # the same id can be retried
    assert upload(db_client, headers, client_id=client_id).status_code == 201


def test_storage_outage_is_a_503(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    ocr, storage = fakes
    storage.down = True
    headers, _ = user
    assert upload(db_client, headers).status_code == 503
    assert ocr.calls == 0


@pytest.mark.parametrize(
    "image", [b"", b"%PDF-1.7 not an image", b"GIF89a....."], ids=["empty", "pdf", "gif"]
)
def test_upload_rejects_non_images(db_client: TestClient, fakes, user, image: bytes) -> None:  # noqa: ANN001
    headers, _ = user
    response = upload(db_client, headers, image)
    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "image"
    assert fakes[1].objects == {}


def test_upload_needs_a_uuid_client_id(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    headers, _ = user
    assert upload(db_client, headers, client_id="not-a-uuid").status_code == 422


# ---------- sanitised photos (Phase 8D.3) ----------


def photo_path(headers: dict[str, str], client_id: str) -> str:
    return f"{headers_user_id(headers)}/{client_id}.jpg"


def test_only_the_sanitised_jpeg_is_stored_and_read(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    ocr, storage = fakes
    headers, _ = user
    original = photo(RECEIPT, fmt="PNG", gps=True, extras=True)
    response = upload(db_client, headers, original)
    assert response.status_code == 201, response.text

    path = photo_path(headers, response.json()["id"])
    assert list(storage.objects) == [path]  # .jpg even though a PNG was uploaded
    assert storage.content_types[path] == "image/jpeg"
    stored = storage.objects[path]
    assert stored == images.sanitize(original).data
    assert ocr.images == [stored]  # OCR never sees the original file
    assert b"Exif" not in stored and b"14.5833" not in stored and b"ZZ secret" not in stored


def test_undecodable_upload_is_refused_before_anything_is_written(
    db_client: TestClient,
    fakes,
    user,  # noqa: ANN001
) -> None:
    ocr, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    response = upload(db_client, headers, b"\xff\xd8\xff\xe0" + b"not really a photo", client_id)
    assert response.status_code == 422
    assert response.json()["errors"][0] == {
        "field": "image",
        "message": "We couldn't read this photo. Take a new photo or choose another one.",
        "code": "unreadable_image",
    }
    assert storage.puts == [] and ocr.calls == 0
    assert db_client.get(f"{API}/{client_id}", headers=headers).status_code == 404


def test_oversized_resolution_is_refused(
    db_client: TestClient,
    fakes,
    user,
    monkeypatch: pytest.MonkeyPatch,  # noqa: ANN001
) -> None:
    monkeypatch.setitem(images.MAX_SOURCE_PIXELS, "JPEG", 1000)
    response = upload(db_client, user[0])
    assert response.status_code == 422
    assert response.json()["errors"][0]["code"] == "too_many_pixels"
    assert fakes[1].puts == []


# ---------- retries (Phase 8D.3) ----------


def test_identical_retry_returns_the_receipt_and_writes_nothing(
    db_client: TestClient,
    fakes,
    user,  # noqa: ANN001
) -> None:
    ocr, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    first = upload(db_client, headers, client_id=client_id)
    again = upload(db_client, headers, client_id=client_id)
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json() == first.json()
    assert storage.puts == [photo_path(headers, client_id)] and storage.deletes == []
    assert ocr.calls == 1


def test_a_different_photo_under_a_used_id_is_refused(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    ocr, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    accepted = upload(db_client, headers, client_id=client_id).json()
    stored = dict(storage.objects)

    other = upload(db_client, headers, NOT_A_RECEIPT, client_id)
    assert other.status_code == 409
    assert other.json()["detail"] == (
        "This upload id was already used for a different photo. Scan again."
    )
    assert storage.objects == stored and storage.deletes == []  # accepted photo untouched
    assert db_client.get(f"{API}/{client_id}", headers=headers).json() == accepted
    assert ocr.calls == 1


def test_retry_matches_a_photo_stored_before_sanitising(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    _, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    upload(db_client, headers, client_id=client_id)
    storage.objects[photo_path(headers, client_id)] = JPEG  # as stored before Phase 8D.3
    assert upload(db_client, headers, client_id=client_id).status_code == 200


def test_retry_when_the_stored_photo_is_missing_returns_the_receipt(
    db_client: TestClient,
    fakes,
    user,  # noqa: ANN001
) -> None:
    _, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    upload(db_client, headers, client_id=client_id)
    storage.objects.clear()
    retry = upload(db_client, headers, client_id=client_id)
    assert retry.status_code == 200 and storage.objects == {}  # nothing re-stored


def test_retry_check_during_a_storage_outage_is_a_503(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    _, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    upload(db_client, headers, client_id=client_id)
    storage.get_down = True
    assert upload(db_client, headers, client_id=client_id).status_code == 503
    storage.get_down = False
    assert db_client.get(f"{API}/{client_id}", headers=headers).json()["status"] == "draft"


def test_interrupted_upload_leaves_a_photo_the_retry_reuses(
    db_client: TestClient,
    fakes,
    user,  # noqa: ANN001
) -> None:
    ocr, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    path = photo_path(headers, client_id)
    # The photo is stored, OCR fails, and deleting the photo again fails too.
    ocr.down, storage.delete_down = True, True
    assert upload(db_client, headers, client_id=client_id).status_code == 503
    assert list(storage.objects) == [path]  # orphan: no receipt row
    assert db_client.get(f"{API}/{client_id}", headers=headers).status_code == 404

    ocr.down, storage.delete_down = False, False
    retry = upload(db_client, headers, client_id=client_id)
    assert retry.status_code == 201 and retry.json()["status"] == "draft"
    assert storage.puts == [path, path]  # the second put found the identical photo
    assert storage.deletes == [] and storage.objects[path] == images.sanitize(JPEG).data


def test_lost_response_after_the_photo_was_stored_is_retried(
    db_client: TestClient,
    fakes,
    user,  # noqa: ANN001
) -> None:
    ocr, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    storage.fail_after_put = True  # stored, but the storage call times out
    assert upload(db_client, headers, client_id=client_id).status_code == 503
    assert ocr.calls == 0 and len(storage.objects) == 1

    storage.fail_after_put = False
    assert upload(db_client, headers, client_id=client_id).status_code == 201
    assert len(storage.objects) == 1 and storage.deletes == []


def test_leftover_of_a_different_photo_is_replaced_not_reused(
    db_client: TestClient,
    fakes,
    user,  # noqa: ANN001
) -> None:
    ocr, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    path = photo_path(headers, client_id)
    ocr.down, storage.delete_down = True, True
    upload(db_client, headers, NOT_A_RECEIPT, client_id)  # leaves the notes photo behind
    ocr.down, storage.delete_down = False, False

    retry = upload(db_client, headers, JPEG, client_id)  # a client reusing its id
    assert retry.status_code == 201 and retry.json()["status"] == "draft"
    assert storage.deletes == [path]  # the never-accepted leftover was removed first
    assert storage.objects[path] == images.sanitize(JPEG).data


def _slow_first_read(ocr: FakeOcr, started: threading.Event) -> None:
    original = ocr.read

    def read(image: bytes) -> OcrResult:
        if not started.is_set():
            started.set()
            time.sleep(0.4)  # the second request arrives while this one holds the row
        return original(image)

    ocr.read = read  # type: ignore[method-assign]


@pytest.mark.parametrize(
    ("second_photo", "expected"),
    [(JPEG, [200, 201]), (NOT_A_RECEIPT, [201, 409])],
    ids=["same-photo", "different-photo"],
)
def test_concurrent_uploads_with_one_id_store_one_photo(
    db_client: TestClient,
    fakes,
    user,
    second_photo: bytes,
    expected: list[int],  # noqa: ANN001
) -> None:
    ocr, storage = fakes
    headers, _ = user
    client_id = str(uuid.uuid4())
    started = threading.Event()
    _slow_first_read(ocr, started)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(upload, db_client, headers, JPEG, client_id)
        assert started.wait(5)
        second = pool.submit(upload, db_client, headers, second_photo, client_id)
        codes = [first.result().status_code, second.result().status_code]

    assert sorted(codes) == expected
    path = photo_path(headers, client_id)
    assert storage.puts == [path]  # only the request holding the new row wrote the photo
    assert storage.objects == {path: images.sanitize(JPEG).data}
    assert ocr.calls == 1


def test_users_never_share_a_photo_path(
    db_client: TestClient,
    fakes,
    make_user,
    auth_header,  # noqa: ANN001
) -> None:
    ocr, storage = fakes
    alice, bob = auth_header(make_user()), auth_header(make_user())
    client_id = str(uuid.uuid4())
    ocr.down, storage.delete_down = True, True
    upload(db_client, alice, NOT_A_RECEIPT, client_id)  # alice's orphaned photo
    ocr.down, storage.delete_down = False, False

    assert upload(db_client, bob, JPEG, client_id).status_code == 201  # no row existed
    alice_path, bob_path = photo_path(alice, client_id), photo_path(bob, client_id)
    assert storage.objects[alice_path] == images.sanitize(NOT_A_RECEIPT).data  # untouched
    assert storage.objects[bob_path] == images.sanitize(JPEG).data
    assert storage.deletes == []


# ---------- auth and isolation ----------


def test_every_receipt_route_needs_a_token(db_client: TestClient, fakes) -> None:  # noqa: ANN001
    rid = uuid.uuid4()
    assert db_client.post(API, data={"client_id": str(rid)}).status_code == 401
    assert db_client.get(f"{API}/{rid}").status_code == 401
    assert db_client.post(f"{API}/{rid}/confirm", json={}).status_code == 401
    assert db_client.delete(f"{API}/{rid}").status_code == 401


def test_other_users_cannot_read_confirm_discard_or_reuse_a_receipt(
    db_client: TestClient,
    fakes,
    make_user,
    auth_header,  # noqa: ANN001
) -> None:
    owner = auth_header(make_user())
    other = auth_header(make_user())
    rid = upload(db_client, owner).json()["id"]
    cats = {c["name"]: c["id"] for c in db_client.get("/api/v1/categories", headers=other).json()}

    assert db_client.get(f"{API}/{rid}", headers=other).status_code == 404
    assert (
        db_client.post(f"{API}/{rid}/confirm", headers=other, json=confirm_body(cats)).status_code
        == 404
    )
    assert db_client.delete(f"{API}/{rid}", headers=other).status_code == 404
    # Reusing someone else's id as an upload id doesn't reveal or touch their receipt.
    assert upload(db_client, other, client_id=rid).status_code == 409
    assert db_client.get(f"{API}/{rid}", headers=owner).json()["status"] == "draft"


def test_rls_hides_receipts_from_other_users(
    db_client: TestClient,
    fakes,
    make_user,
    auth_header,
    as_user,  # noqa: ANN001
) -> None:
    owner_id, other_id = make_user(), make_user()
    rid = upload(db_client, auth_header(owner_id)).json()["id"]
    query = text("select count(*) from receipts where id = :id")
    assert as_user(owner_id).execute(query, {"id": rid}).scalar() == 1
    assert as_user(other_id).execute(query, {"id": rid}).scalar() == 0


# ---------- confirm ----------


def test_confirm_creates_transaction_items_and_updates_budgets(
    db_client: TestClient,
    fakes,
    user,  # noqa: ANN001
) -> None:
    headers, cats = user
    budget = db_client.post(
        "/api/v1/budgets",
        headers=headers,
        json={"category_id": cats["Groceries"], "period_type": "weekly", "limit_amount": "150.00"},
    )
    assert budget.status_code == 201, budget.text
    rid = upload(db_client, headers).json()["id"]

    response = db_client.post(f"{API}/{rid}/confirm", headers=headers, json=confirm_body(cats))
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["already_confirmed"] is False
    assert saved["source"] == "receipt" and saved["receipt_id"] == rid
    assert saved["amount"] == "140.00" and saved["item_count"] == 2
    assert [a["level"] for a in saved["budget_alerts"]] == ["near"]  # 140 of 150

    detail = db_client.get(f"/api/v1/transactions/{saved['id']}", headers=headers).json()
    items = {i["name"]: i for i in detail["items"]}
    # The ₱9.50 senior discount is spread over the items, so they add up to what was paid.
    assert sum(Decimal(i["line_total"]) for i in detail["items"]) == Decimal("140.00")
    assert items["Bear Brand 33G"]["quantity"] == "3.000"
    assert Decimal(items["Eggs large"]["discount"]) > 0

    status = db_client.get("/api/v1/budgets/status", headers=headers).json()
    assert status[0]["spent"] == "140.00" and status[0]["level"] == "near"
    receipt = db_client.get(f"{API}/{rid}", headers=headers).json()
    assert receipt["status"] == "confirmed" and receipt["transaction_id"] == saved["id"]


def test_repeated_confirm_returns_the_same_transaction(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    headers, cats = user
    rid = upload(db_client, headers).json()["id"]
    first = db_client.post(f"{API}/{rid}/confirm", headers=headers, json=confirm_body(cats))
    again = db_client.post(f"{API}/{rid}/confirm", headers=headers, json=confirm_body(cats))
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"] and again.json()["already_confirmed"] is True
    assert again.json()["budget_alerts"] == []
    listed = db_client.get("/api/v1/transactions", headers=headers).json()["items"]
    assert len(listed) == 1


def test_confirm_checks_items_against_the_total(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    headers, cats = user
    rid = upload(db_client, headers).json()["id"]
    response = db_client.post(
        f"{API}/{rid}/confirm", headers=headers, json=confirm_body(cats, total="150.00")
    )
    assert response.status_code == 422
    error = response.json()["errors"][0]
    assert error["field"] == "total" and error["code"] == "items_mismatch"
    assert "₱140.00" in error["message"]
    # Within ±₱0.01 is accepted.
    ok = db_client.post(
        f"{API}/{rid}/confirm", headers=headers, json=confirm_body(cats, total="140.01")
    )
    assert ok.status_code == 200 and ok.json()["amount"] == "140.01"


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"total": "0"}, "total"),
        ({"total": "-5"}, "total"),
        ({"items": [{"name": "X", "quantity": "0", "unit_price": "1.00"}]}, "items.0.quantity"),
        ({"items": [{"name": "X", "unit_price": "-1.00"}]}, "items.0.unit_price"),
        ({"items": [{"name": " ", "unit_price": "1.00"}]}, "items.0.name"),
        (
            {
                "total": "1.00",
                "discount": "0",
                "items": [{"name": "X", "unit_price": "1.00", "discount": "2.00"}],
            },
            "items.0.discount",
        ),
        ({"total": "5.00", "items": []}, "discount"),
        ({"occurred_at": "2099-01-01T00:00:00+08:00"}, "occurred_at"),
        ({"category_id": str(uuid.uuid4())}, "category_id"),
    ],
)
def test_confirm_validation(db_client: TestClient, fakes, user, overrides, field) -> None:  # noqa: ANN001
    headers, cats = user
    rid = upload(db_client, headers).json()["id"]
    response = db_client.post(
        f"{API}/{rid}/confirm", headers=headers, json=confirm_body(cats, **overrides)
    )
    assert response.status_code == 422, response.text
    assert response.json()["errors"][0]["field"] == field
    assert db_client.get("/api/v1/transactions", headers=headers).json()["items"] == []
    assert db_client.get(f"{API}/{rid}", headers=headers).json()["status"] == "draft"


def test_confirm_without_items(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    headers, cats = user
    rid = upload(db_client, headers).json()["id"]
    response = db_client.post(
        f"{API}/{rid}/confirm",
        headers=headers,
        json=confirm_body(cats, total="140.00", discount="0", items=[]),
    )
    assert response.status_code == 200 and response.json()["item_count"] == 0


def test_failed_receipts_cannot_be_confirmed(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    headers, cats = user
    rid = upload(db_client, headers, UNREADABLE).json()["id"]
    response = db_client.post(f"{API}/{rid}/confirm", headers=headers, json=confirm_body(cats))
    assert response.status_code == 409


def test_confirm_is_atomic(db_client: TestClient, fakes, user, admin_engine: Engine) -> None:  # noqa: ANN001
    """If anything fails mid-way, no transaction, items or receipt status change remain."""
    headers, cats = user
    rid = upload(db_client, headers).json()["id"]
    with admin_engine.begin() as conn:  # make the line-item insert fail inside the confirm
        conn.execute(
            text(
                "alter table transaction_line_items add constraint zz_test_block"
                " check (name <> 'ZZ BLOCK') not valid"
            )
        )
    try:
        body = confirm_body(
            cats,
            items=[{"name": "ZZ BLOCK", "unit_price": "149.50"}],
        )
        response = db_client.post(f"{API}/{rid}/confirm", headers=headers, json=body)
        assert response.status_code == 500
    finally:
        with admin_engine.begin() as conn:
            conn.execute(text("alter table transaction_line_items drop constraint zz_test_block"))
    assert db_client.get("/api/v1/transactions", headers=headers).json()["items"] == []
    assert db_client.get(f"{API}/{rid}", headers=headers).json()["status"] == "draft"


def test_possible_duplicate_is_reported(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    headers, cats = user
    manual = db_client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "amount": "140.00",
            "category_id": cats["Groceries"],
            "occurred_at": datetime.now(periods.app_tz()).isoformat(),
        },
    ).json()
    draft = upload(db_client, headers).json()
    assert draft["possible_duplicate"]["id"] == manual["id"]


# ---------- discard ----------


def test_discard_removes_draft_and_image(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    _, storage = fakes
    headers, cats = user
    rid = upload(db_client, headers).json()["id"]
    failed = upload(db_client, headers, UNREADABLE).json()["id"]
    assert db_client.delete(f"{API}/{rid}", headers=headers).status_code == 204
    assert db_client.delete(f"{API}/{failed}", headers=headers).status_code == 204
    assert storage.objects == {}
    assert db_client.get(f"{API}/{rid}", headers=headers).status_code == 404
    assert db_client.delete(f"{API}/{rid}", headers=headers).status_code == 404


def test_saved_receipts_cannot_be_discarded(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    _, storage = fakes
    headers, cats = user
    rid = upload(db_client, headers).json()["id"]
    db_client.post(f"{API}/{rid}/confirm", headers=headers, json=confirm_body(cats))
    assert db_client.delete(f"{API}/{rid}", headers=headers).status_code == 409
    assert len(storage.objects) == 1


def test_discard_keeps_the_receipt_when_storage_is_down(db_client: TestClient, fakes, user) -> None:  # noqa: ANN001
    _, storage = fakes
    headers, _ = user
    rid = upload(db_client, headers).json()["id"]
    storage.down = True
    assert db_client.delete(f"{API}/{rid}", headers=headers).status_code == 503
    assert db_client.get(f"{API}/{rid}", headers=headers).status_code == 200
