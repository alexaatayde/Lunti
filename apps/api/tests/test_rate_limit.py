"""Per-user rate limits (Phase 8B): the limiter itself, then the limited endpoints."""

import threading
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.core.config import settings
from app.core.rate_limit import RateLimiter, Rule, parse_rules, retry_after_header
from app.main import app
from app.modules.expenses import periods

# ---------- limiter ----------


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_parse_rules() -> None:
    assert parse_rules("10/minute, 50/day") == (Rule(10, 60), Rule(50, 86400))
    assert parse_rules("2/seconds;3/hour") == (Rule(2, 1), Rule(3, 3600))
    assert parse_rules("") == ()
    for bad in ("10", "0/minute", "x/minute", "5/fortnight", "-1/day"):
        with pytest.raises(ValueError, match="Invalid rate limit"):
            parse_rules(bad)


def test_every_configured_limit_parses() -> None:
    for name in (
        "rate_limit_receipt_upload",
        "rate_limit_receipt_confirm",
        "rate_limit_transaction_create",
    ):
        assert parse_rules(getattr(settings, name))


def test_allows_up_to_the_limit_then_says_how_long_to_wait() -> None:
    clock = Clock()
    limiter = RateLimiter(clock)
    rules = (Rule(3, 60),)
    for _ in range(3):
        assert limiter.hit("b", "u", rules) is None
        clock.now += 10
    # Hits at 1000, 1010, 1020; now 1030. The first ages out at 1060.
    assert limiter.hit("b", "u", rules) == pytest.approx(30)
    clock.now = 1060.5
    assert limiter.hit("b", "u", rules) is None


def test_rejected_requests_are_not_counted() -> None:
    """A client that keeps retrying while limited isn't punished with a longer wait."""
    clock = Clock()
    limiter = RateLimiter(clock)
    rules = (Rule(1, 60),)
    assert limiter.hit("b", "u", rules) is None
    for _ in range(20):
        clock.now += 1
        assert limiter.hit("b", "u", rules) is not None
    clock.now = 1060.1
    assert limiter.hit("b", "u", rules) is None


def test_the_strictest_window_decides() -> None:
    clock = Clock()
    limiter = RateLimiter(clock)
    rules = (Rule(2, 60), Rule(3, 3600))
    assert limiter.hit("b", "u", rules) is None
    assert limiter.hit("b", "u", rules) is None
    assert limiter.hit("b", "u", rules) == pytest.approx(60)  # per-minute window
    clock.now += 61
    assert limiter.hit("b", "u", rules) is None
    clock.now += 61
    # Three in the hour: wait until the first one (at 1000) is an hour old.
    assert limiter.hit("b", "u", rules) == pytest.approx(1000 + 3600 - clock.now)


def test_users_and_endpoints_have_separate_allowances() -> None:
    limiter = RateLimiter(Clock())
    rules = (Rule(1, 60),)
    assert limiter.hit("upload", "alice", rules) is None
    assert limiter.hit("upload", "alice", rules) is not None
    assert limiter.hit("upload", "bob", rules) is None  # Alice can't use up Bob's
    assert limiter.hit("confirm", "alice", rules) is None  # nor her other endpoints'


def test_concurrent_requests_cannot_exceed_the_limit() -> None:
    limiter = RateLimiter()
    rules = (Rule(10, 60),)
    start = threading.Barrier(50)

    def hit(_: int) -> bool:
        start.wait()
        return limiter.hit("b", "u", rules) is None

    with ThreadPoolExecutor(max_workers=50) as pool:
        allowed = sum(pool.map(hit, range(50)))
    assert allowed == 10


def test_idle_subjects_are_pruned() -> None:
    clock = Clock()
    limiter = RateLimiter(clock)
    rules = (Rule(5, 60),)
    for i in range(999):
        limiter.hit("b", f"user-{i}", rules)
    clock.now += 120
    limiter.hit("b", "late", rules)  # the 1000th hit sweeps
    assert list(limiter._hits) == [("b", "late")]


def test_no_rules_means_no_limit() -> None:
    limiter = RateLimiter(Clock())
    assert all(limiter.hit("b", "u", ()) is None for _ in range(100))


@pytest.mark.parametrize(("wait", "header"), [(0.01, "1"), (1.0, "1"), (1.2, "2"), (59.9, "60")])
def test_retry_after_is_whole_seconds_rounded_up(wait: float, header: str) -> None:
    assert retry_after_header(wait) == header


# ---------- endpoints ----------

JPEG = b"\xff\xd8\xff\xe0" + b"receipt-photo"


class CountingOcr:
    name = "google_vision"

    def __init__(self) -> None:
        self.calls = 0

    def read(self, image: bytes):  # noqa: ANN201
        from app.modules.receipts.ocr import OcrResult

        self.calls += 1
        return OcrResult("Meeting notes\nnothing to buy", 0.97, "google_vision")


class MemoryStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, path: str, data: bytes, content_type: str) -> None:
        self.objects[path] = data

    def delete(self, path: str) -> None:
        self.objects.pop(path, None)

    def signed_url(self, path: str) -> str | None:
        return None


@pytest.fixture
def ocr(db_client: TestClient) -> Iterator[CountingOcr]:
    from app.modules.receipts.ocr import get_ocr
    from app.modules.receipts.storage import get_storage

    engine, storage = CountingOcr(), MemoryStorage()
    app.dependency_overrides[get_ocr] = lambda: engine
    app.dependency_overrides[get_storage] = lambda: storage
    yield engine


def upload(client: TestClient, headers: dict, client_id: str | None = None):  # noqa: ANN201
    return client.post(
        "/api/v1/receipts",
        headers=headers,
        data={"client_id": client_id or str(uuid.uuid4())},
        files={"image": ("r.jpg", JPEG, "image/jpeg")},
    )


@pytest.mark.db
def test_receipt_uploads_are_limited_per_user_before_any_ocr(
    db_client: TestClient,
    ocr: CountingOcr,
    make_user,
    auth_header,
    limits_on,
    monkeypatch: pytest.MonkeyPatch,  # noqa: ANN001
) -> None:
    monkeypatch.setattr(settings, "rate_limit_receipt_upload", "2/minute")
    alice, bob = auth_header(make_user()), auth_header(make_user())

    assert upload(db_client, alice).status_code == 201
    assert upload(db_client, alice).status_code == 201
    limited = upload(db_client, alice)

    assert limited.status_code == 429
    assert limited.headers["content-type"] == "application/problem+json"
    assert limited.json()["type"] == "urn:lunti:problem:rate-limited"
    assert 1 <= int(limited.headers["Retry-After"]) <= 60
    assert ocr.calls == 2  # the limited request never reached OCR
    # Another user is unaffected.
    assert upload(db_client, bob).status_code == 201


@pytest.mark.db
def test_concurrent_uploads_cannot_bypass_the_limit(
    db_client: TestClient,
    ocr: CountingOcr,
    make_user,
    auth_header,
    limits_on,
    monkeypatch: pytest.MonkeyPatch,  # noqa: ANN001
) -> None:
    monkeypatch.setattr(settings, "rate_limit_receipt_upload", "3/minute")
    headers = auth_header(make_user())
    start = threading.Barrier(10)

    def send(_: int) -> int:
        start.wait()
        return upload(db_client, headers).status_code

    with ThreadPoolExecutor(max_workers=10) as pool:
        statuses = sorted(pool.map(send, range(10)))
    assert statuses == [201] * 3 + [429] * 7
    assert ocr.calls == 3


@pytest.mark.db
def test_limit_resets_after_retry_after(
    db_client: TestClient,
    make_user,
    auth_header,
    limits_on,
    monkeypatch: pytest.MonkeyPatch,  # noqa: ANN001
) -> None:
    from app.core.rate_limit import get_rate_limiter

    clock = Clock()
    limiter = RateLimiter(clock)
    app.dependency_overrides[get_rate_limiter] = lambda: limiter
    monkeypatch.setattr(settings, "rate_limit_transaction_create", "1/minute")
    headers = auth_header(make_user())
    cats = {c["name"]: c["id"] for c in db_client.get("/api/v1/categories", headers=headers).json()}
    body = {
        "amount": "5.00",
        "category_id": cats["Others"],
        "occurred_at": datetime.now(periods.app_tz()).isoformat(),
    }

    assert db_client.post("/api/v1/transactions", headers=headers, json=body).status_code == 201
    limited = db_client.post("/api/v1/transactions", headers=headers, json=body)
    assert limited.status_code == 429
    clock.now += int(limited.headers["Retry-After"])
    assert db_client.post("/api/v1/transactions", headers=headers, json=body).status_code == 201


@pytest.mark.db
def test_a_limited_transaction_create_writes_nothing(
    db_client: TestClient,
    make_user,
    auth_header,
    admin_engine: Engine,
    limits_on,
    monkeypatch: pytest.MonkeyPatch,  # noqa: ANN001
) -> None:
    monkeypatch.setattr(settings, "rate_limit_transaction_create", "1/minute")
    user_id = make_user()
    headers = auth_header(user_id)
    cats = {c["name"]: c["id"] for c in db_client.get("/api/v1/categories", headers=headers).json()}
    body = {
        "amount": "5.00",
        "category_id": cats["Others"],
        "occurred_at": datetime.now(periods.app_tz()).isoformat(),
    }
    first = db_client.post(
        "/api/v1/transactions", headers={**headers, "Idempotency-Key": "k-1234567"}, json=body
    )
    second = db_client.post(
        "/api/v1/transactions", headers={**headers, "Idempotency-Key": "k-7654321"}, json=body
    )
    assert (first.status_code, second.status_code) == (201, 429)
    with admin_engine.connect() as conn:
        assert (
            conn.execute(
                text("select count(*) from transactions where user_id = :u"), {"u": user_id}
            ).scalar_one()
            == 1
        )


@pytest.mark.db
def test_receipt_confirm_is_limited(
    db_client: TestClient,
    make_user,
    auth_header,
    limits_on,
    monkeypatch: pytest.MonkeyPatch,  # noqa: ANN001
) -> None:
    monkeypatch.setattr(settings, "rate_limit_receipt_confirm", "1/minute")
    headers = auth_header(make_user())
    body = {
        "category_id": str(uuid.uuid4()),
        "occurred_at": datetime.now(periods.app_tz()).isoformat(),
        "total": "1.00",
        "items": [],
    }
    first = db_client.post(f"/api/v1/receipts/{uuid.uuid4()}/confirm", headers=headers, json=body)
    second = db_client.post(f"/api/v1/receipts/{uuid.uuid4()}/confirm", headers=headers, json=body)
    assert first.status_code == 404  # counted, then not found
    assert second.status_code == 429


def test_unauthenticated_requests_get_401_not_429(client: TestClient, limits_on) -> None:  # noqa: ANN001
    for _ in range(3):
        response = client.post("/api/v1/transactions", json={})
        assert response.status_code == 401


@pytest.mark.db
def test_limits_can_be_switched_off(
    db_client: TestClient,
    make_user,
    auth_header,
    monkeypatch: pytest.MonkeyPatch,  # noqa: ANN001
) -> None:
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    monkeypatch.setattr(settings, "rate_limit_receipt_confirm", "1/minute")
    headers = auth_header(make_user())
    for _ in range(3):
        r = db_client.post(f"/api/v1/receipts/{uuid.uuid4()}/confirm", headers=headers, json={})
        assert r.status_code == 422


def test_429_is_documented_with_retry_after() -> None:
    spec = app.openapi()
    for path, method in (
        ("/api/v1/receipts", "post"),
        ("/api/v1/receipts/{receipt_id}/confirm", "post"),
        ("/api/v1/transactions", "post"),
    ):
        response = spec["paths"][path][method]["responses"]["429"]
        assert "Retry-After" in response["headers"]
