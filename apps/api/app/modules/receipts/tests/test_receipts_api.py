"""/receipts against a real database (needs TEST_DATABASE_URL). OCR and storage are fakes."""

import uuid
from collections.abc import Iterator
from datetime import datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.main import app
from app.modules.expenses import periods
from app.modules.receipts.ocr import OcrResult, OcrUnavailable, get_ocr
from app.modules.receipts.storage import StorageUnavailable, get_storage

pytestmark = pytest.mark.db

API = "/api/v1/receipts"
JPEG = b"\xff\xd8\xff\xe0" + b"receipt-photo"
UNREADABLE = b"\xff\xd8\xff\xe0" + b"blurry"
NOT_A_RECEIPT = b"\xff\xd8\xff\xe0" + b"notes"


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

    def read(self, image: bytes) -> OcrResult:
        self.calls += 1
        if self.down:
            raise OcrUnavailable
        if image == UNREADABLE:
            return OcrResult("", None, "google_vision")
        if image == NOT_A_RECEIPT:
            return OcrResult("Meeting notes\nCall the landlord", 0.97, "google_vision")
        return OcrResult(receipt_text(), 0.9, "google_vision")


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.down = False

    def put(self, path: str, data: bytes, content_type: str) -> None:
        if self.down:
            raise StorageUnavailable
        assert path not in self.objects
        self.objects[path] = data

    def delete(self, path: str) -> None:
        if self.down:
            raise StorageUnavailable
        self.objects.pop(path, None)

    def signed_url(self, path: str) -> str | None:
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
