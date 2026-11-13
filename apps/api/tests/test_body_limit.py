"""Request body size limit (Phase 8B): oversized bodies get 413 before they are read in full."""

import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.body_limit import UPLOAD_OVERHEAD_BYTES, limit_for
from app.core.config import settings


def test_limits_per_route() -> None:
    assert (
        limit_for("POST", "/api/v1/receipts") == settings.receipt_max_bytes + UPLOAD_OVERHEAD_BYTES
    )
    assert limit_for("POST", "/api/v1/receipts/") == limit_for("POST", "/api/v1/receipts")
    assert limit_for("POST", "/api/v1/transactions") == settings.request_max_bytes
    assert limit_for("GET", "/api/v1/receipts") == settings.request_max_bytes


def test_declared_oversized_json_body_is_refused(client: TestClient, auth_header) -> None:  # noqa: ANN001
    big = b'{"note": "' + b"x" * (settings.request_max_bytes + 10) + b'"}'
    response = client.post(
        "/api/v1/transactions",
        content=big,
        headers={**auth_header(uuid.uuid4()), "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["type"] == "urn:lunti:problem:payload-too-large"
    assert response.headers["X-Request-ID"]


def test_streamed_oversized_body_is_cut_off(client: TestClient, auth_header) -> None:  # noqa: ANN001
    """No Content-Length (chunked): counted while it arrives."""
    sent = {"chunks": 0}

    def chunks() -> Iterator[bytes]:
        for _ in range(64):
            sent["chunks"] += 1
            yield b"x" * 65536

    response = client.post(
        "/api/v1/transactions",
        content=chunks(),
        headers={**auth_header(uuid.uuid4()), "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["type"] == "urn:lunti:problem:payload-too-large"


@pytest.mark.db
def test_receipt_photo_over_the_limit_is_refused_and_one_under_is_accepted(
    db_client: TestClient,
    make_user,
    auth_header,
    monkeypatch: pytest.MonkeyPatch,  # noqa: ANN001
) -> None:
    from app.main import app
    from app.modules.receipts.ocr import OcrResult, get_ocr
    from app.modules.receipts.storage import get_storage

    class Ocr:
        name = "google_vision"

        def read(self, image: bytes) -> OcrResult:
            return OcrResult("", None, "google_vision")

    class Storage:
        def put(self, *a) -> None: ...  # noqa: ANN002
        def delete(self, *a) -> None: ...  # noqa: ANN002
        def signed_url(self, *a) -> None: ...  # noqa: ANN002

    app.dependency_overrides[get_ocr] = Ocr
    app.dependency_overrides[get_storage] = Storage
    monkeypatch.setattr(settings, "receipt_max_bytes", 200_000)
    headers = auth_header(make_user())

    def send(size: int):  # noqa: ANN202
        photo = b"\xff\xd8\xff\xe0" + b"x" * (size - 4)
        return db_client.post(
            "/api/v1/receipts",
            headers=headers,
            data={"client_id": str(uuid.uuid4())},
            files={"image": ("r.jpg", photo, "image/jpeg")},
        )

    assert send(200_000).status_code == 201  # at the limit: read (fails OCR, but accepted)
    too_big = send(200_000 + UPLOAD_OVERHEAD_BYTES + 1)
    assert too_big.status_code == 413
