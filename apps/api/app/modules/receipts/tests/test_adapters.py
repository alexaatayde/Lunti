"""OCR and storage adapters, image checks and discount allocation (no database)."""

import base64
import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace as NS

import httpx
import pytest

from app.core.config import settings
from app.core.errors import ApiError
from app.modules.expenses.transaction_service import ReceiptLine
from app.modules.receipts import images
from app.modules.receipts import ocr as ocr_module
from app.modules.receipts import storage as storage_module
from app.modules.receipts.ocr import (
    FixtureOcr,
    GoogleVisionOcr,
    OcrUnavailable,
    Word,
    rows_from_words,
)
from app.modules.receipts.service import allocate_discount
from app.modules.receipts.storage import (
    SIGNED_URL_SECONDS,
    InvalidObjectPath,
    LocalStorage,
    ObjectExists,
    StorageUnavailable,
    StoredObject,
    SupabaseStorage,
    service_key_kind,
)

FIXTURES = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "receipts"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 20
USER = "11111111-1111-4111-8111-111111111111"
PATH = f"{USER}/22222222-2222-4222-8222-222222222222.jpg"
OTHER = f"{USER}/33333333-3333-4333-8333-333333333333.jpg"


# ---------- rows ----------


def test_rows_join_columns_and_split_numbers() -> None:
    words = [
        Word("BREAD", 10, 70, 100, 120),
        Word("45", 300, 324, 101, 121),
        Word(".", 324, 330, 101, 121),
        Word("00", 330, 354, 102, 122),
        Word("TOTAL", 10, 70, 140, 160),
        Word("45.00", 300, 354, 141, 161),
    ]
    assert rows_from_words(words) == ["BREAD   45.00", "TOTAL   45.00"]
    assert rows_from_words([]) == []


# ---------- Google Vision (with a fake client) ----------


def _vision_word(text: str, x0: int, y0: int, conf: float) -> NS:
    vertices = [NS(x=x0, y=y0), NS(x=x0 + 12 * len(text), y=y0), NS(x=x0, y=y0 + 20)]
    return NS(
        symbols=[NS(text=c) for c in text], bounding_box=NS(vertices=vertices), confidence=conf
    )


def _vision(words: list[NS], error: str = "") -> GoogleVisionOcr:
    engine = GoogleVisionOcr.__new__(GoogleVisionOcr)
    annotation = NS(text="", pages=[NS(blocks=[NS(paragraphs=[NS(words=words)])])])
    response = NS(error=NS(message=error, code=3 if error else 0), full_text_annotation=annotation)
    engine._vision = NS(Image=lambda content: content)
    engine.calls = []  # type: ignore[attr-defined]

    def detect(**kwargs):  # noqa: ANN003, ANN202
        engine.calls.append(kwargs)  # type: ignore[attr-defined]
        return response

    engine._client = NS(document_text_detection=detect)
    engine.timeout = 25.0
    return engine


def test_vision_result_has_rows_and_mean_confidence() -> None:
    result = _vision([_vision_word("MILK", 0, 0, 0.9), _vision_word("90.50", 200, 1, 0.7)]).read(
        b"img"
    )
    assert result.text == "MILK   90.50"
    assert result.confidence == pytest.approx(0.8)
    assert result.engine == "google_vision" and not result.simulated


def test_vision_sends_one_request_with_a_timeout_and_no_retries() -> None:
    engine = _vision([_vision_word("MILK", 0, 0, 0.9)])
    engine.read(b"img")
    (call,) = engine.calls  # type: ignore[attr-defined]
    assert call["retry"] is None  # each retry could be billed: never resend automatically
    assert call["timeout"] == 25.0


def test_vision_errors_never_carry_the_service_message() -> None:
    with pytest.raises(OcrUnavailable) as error:
        _vision([], error="quota exceeded for project lunti-123 key AIza...").read(b"img")
    assert "AIza" not in str(error.value) and "lunti-123" not in str(error.value)
    assert error.value.__cause__ is None


def test_vision_error_is_unavailable() -> None:
    with pytest.raises(OcrUnavailable):
        _vision([], error="quota").read(b"img")

    def boom(**_):  # noqa: ANN003, ANN202
        raise ConnectionError

    engine = _vision([])
    engine._client = NS(document_text_detection=boom)
    with pytest.raises(OcrUnavailable):
        engine.read(b"img")


# ---------- fixture OCR ----------


def test_fixture_ocr_matches_known_images_only() -> None:
    engine = FixtureOcr(FIXTURES)
    image = (FIXTURES / "zz-test-supermarket.png").read_bytes()
    result = engine.read(image)
    assert result.simulated and result.engine == "fixture"
    assert "ZZ TEST SUPERMARKET" in result.text
    assert engine.read(b"some other photo").text == ""


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch):  # noqa: ANN201
    ocr_module.get_ocr.cache_clear()
    storage_module.get_storage.cache_clear()
    yield monkeypatch
    ocr_module.get_ocr.cache_clear()
    storage_module.get_storage.cache_clear()


def test_production_refuses_development_adapters(configured: pytest.MonkeyPatch) -> None:
    configured.setattr(settings, "app_env", "production")
    configured.setattr(settings, "ocr_provider", "fixture")
    configured.setattr(settings, "receipt_storage", "local")
    with pytest.raises(ApiError) as ocr_error:
        ocr_module.get_ocr()
    with pytest.raises(ApiError) as storage_error:
        storage_module.get_storage()
    assert ocr_error.value.status == storage_error.value.status == 503


def test_missing_credentials_never_fall_back(configured: pytest.MonkeyPatch) -> None:
    configured.setattr(settings, "ocr_provider", "google")
    configured.setattr(settings, "google_application_credentials", "")
    configured.setattr(settings, "receipt_storage", "supabase")
    configured.setattr(settings, "supabase_service_role_key", "")
    with pytest.raises(ApiError):
        ocr_module.get_ocr()
    with pytest.raises(ApiError):
        storage_module.get_storage()
    configured.setattr(settings, "ocr_provider", "tesseract")
    with pytest.raises(ApiError):
        ocr_module.get_ocr()


def test_development_adapters_when_explicitly_chosen(configured: pytest.MonkeyPatch) -> None:
    configured.setattr(settings, "app_env", "development")
    configured.setattr(settings, "ocr_provider", "fixture")
    configured.setattr(settings, "receipt_storage", "local")
    assert isinstance(ocr_module.get_ocr(), FixtureOcr)
    assert isinstance(storage_module.get_storage(), LocalStorage)


# ---------- Supabase Storage (fake HTTP) ----------


def _supabase(handler) -> SupabaseStorage:  # noqa: ANN001
    return SupabaseStorage(
        "https://proj.supabase.co/",
        "service-key",
        "receipts",
        transport=httpx.MockTransport(handler),
    )


def test_supabase_upload_sign_and_delete() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if "/object/sign/" in request.url.path:
            return httpx.Response(200, json={"signedURL": "/object/sign/receipts/u/r.jpg?token=t"})
        return httpx.Response(200, json={})

    storage = _supabase(handler)
    storage.put(PATH, b"jpeg", "image/jpeg")
    url = storage.signed_url(PATH)
    storage.delete(PATH)

    upload, sign, delete = seen
    assert upload.method == "POST" and upload.url.path == f"/storage/v1/object/receipts/{PATH}"
    assert upload.headers["authorization"] == "Bearer service-key"
    assert upload.headers["apikey"] == "service-key"
    assert upload.headers["content-type"] == "image/jpeg"
    assert upload.headers["x-upsert"] == "false" and upload.content == b"jpeg"
    assert sign.url.path == f"/storage/v1/object/sign/receipts/{PATH}"
    assert json.loads(sign.content) == {"expiresIn": 600} == {"expiresIn": SIGNED_URL_SECONDS}
    assert url == "https://proj.supabase.co/storage/v1/object/sign/receipts/u/r.jpg?token=t"
    assert delete.method == "DELETE"


def test_supabase_errors_are_unavailable_and_missing_delete_is_ok() -> None:
    storage = _supabase(lambda request: httpx.Response(500))
    with pytest.raises(StorageUnavailable):
        storage.put(PATH, b"x", "image/jpeg")
    with pytest.raises(StorageUnavailable):
        storage.get(PATH)
    with pytest.raises(StorageUnavailable):
        storage.delete(PATH)
    _supabase(lambda request: httpx.Response(404)).delete(PATH)
    not_found_body = {"statusCode": "404", "error": "not_found", "message": "Object not found"}
    _supabase(lambda request: httpx.Response(400, json=not_found_body)).delete(PATH)
    # A 400 that isn't "not found" is a real failure, not "already deleted".
    with pytest.raises(StorageUnavailable):
        _supabase(lambda request: httpx.Response(400, json={"error": "InvalidKey"})).delete(PATH)

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    with pytest.raises(StorageUnavailable):
        _supabase(down).signed_url(PATH)
    with pytest.raises(StorageUnavailable):
        _supabase(down).get(PATH)


def test_local_storage_never_overwrites_or_escapes(tmp_path: Path) -> None:
    storage = LocalStorage(tmp_path)
    storage.put(PATH, PNG, "image/jpeg")
    assert (tmp_path / USER / PATH.split("/")[1]).read_bytes() == PNG
    with pytest.raises(ObjectExists):
        storage.put(PATH, b"other", "image/jpeg")
    assert storage.get(PATH) == PNG  # unchanged
    assert storage.get(OTHER) is None
    with pytest.raises(ValueError):
        storage.put("../outside.png", PNG, "image/png")
    storage.delete(PATH)
    storage.delete(PATH)  # already gone: fine
    assert storage.get(PATH) is None
    assert storage.signed_url(PATH) is None


def test_supabase_lists_files_one_folder_deep_with_server_timestamps() -> None:
    user = "11111111-1111-4111-8111-111111111111"
    pages: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/storage/v1/object/list/receipts"
        body = json.loads(request.content)
        pages.append(body)
        if body["prefix"] == "":
            return httpx.Response(200, json=[{"name": user, "id": None}, {"name": "", "id": None}])
        files = [
            {"name": f"r{i}.jpg", "id": f"id{i}", "created_at": "2026-11-10T01:02:03.000Z"}
            for i in range(body["offset"], min(body["offset"] + body["limit"], 130))
        ]
        return httpx.Response(200, json=files)

    found = list(_supabase(handler).list_objects())

    assert len(found) == 130  # two pages of the user's folder
    assert found[0] == StoredObject(f"{user}/r0.jpg", datetime(2026, 11, 10, 1, 2, 3, tzinfo=UTC))
    assert [p["offset"] for p in pages if p["prefix"] == user] == [0, 100]


def test_supabase_listing_outage_raises_unavailable() -> None:
    with pytest.raises(StorageUnavailable):
        list(_supabase(lambda request: httpx.Response(503)).list_objects())


def test_local_storage_lists_its_files(tmp_path: Path) -> None:
    storage = LocalStorage(tmp_path)
    storage.put(PATH, PNG, "image/jpeg")
    (tmp_path / "stray.txt").write_text("not in a user folder")
    found = list(storage.list_objects())
    assert [o.path for o in found] == [PATH]
    assert found[0].created_at.tzinfo is UTC
    assert list(LocalStorage(tmp_path / "missing").list_objects()) == []


# ---------- object names, duplicates, reads ----------

BAD_PATHS = [
    "../outside.jpg",
    f"{USER}/../../etc/passwd",
    f"{USER}/../33333333-3333-4333-8333-333333333333.jpg",
    "/etc/passwd",
    f"/{PATH}",
    f"{PATH}\n",
    f"{PATH}/x",
    f"{USER}/%2e%2e%2fsecret.jpg",
    f"{USER}/22222222-2222-4222-8222-222222222222.gif",
    f"{USER}/22222222-2222-4222-8222-222222222222",
    PATH.upper(),
    f"other-prefix/{PATH}",
    f"{USER}\\22222222-2222-4222-8222-222222222222.jpg",
    "",
]


@pytest.mark.parametrize("bad", BAD_PATHS)
def test_supabase_refuses_other_object_names_before_any_request(bad: str) -> None:
    seen: list[httpx.Request] = []
    storage = _supabase(lambda request: seen.append(request) or httpx.Response(200, json={}))
    for call in (
        lambda: storage.put(bad, b"x", "image/jpeg"),
        lambda: storage.get(bad),
        lambda: storage.delete(bad),
        lambda: storage.signed_url(bad),
    ):
        with pytest.raises(InvalidObjectPath):
            call()
    assert seen == []


@pytest.mark.parametrize("bad", BAD_PATHS)
def test_local_storage_refuses_other_object_names(bad: str, tmp_path: Path) -> None:
    root = tmp_path / "receipts"
    storage = LocalStorage(root)
    for call in (
        lambda: storage.put(bad, b"x", "image/jpeg"),
        lambda: storage.get(bad),
        lambda: storage.delete(bad),
        lambda: storage.signed_url(bad),
    ):
        with pytest.raises(InvalidObjectPath):
            call()
    assert list(tmp_path.rglob("*")) == []  # nothing written anywhere


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(409, json={"error": "Duplicate"}),
        httpx.Response(400, json={"statusCode": "409", "error": "Duplicate", "message": "exists"}),
    ],
    ids=["409", "400-with-duplicate-body"],
)
def test_supabase_put_reports_an_existing_object(response: httpx.Response) -> None:
    with pytest.raises(ObjectExists):
        _supabase(lambda request: response).put(PATH, b"x", "image/jpeg")


def test_supabase_get_reads_bytes_and_reports_missing_objects() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == f"/storage/v1/object/receipts/{PATH}"
        assert request.headers["authorization"] == "Bearer service-key"
        return httpx.Response(200, content=b"stored-jpeg")

    assert _supabase(handler).get(PATH) == b"stored-jpeg"
    assert _supabase(lambda request: httpx.Response(404)).get(PATH) is None
    missing = {"statusCode": "404", "error": "not_found", "message": "Object not found"}
    assert _supabase(lambda request: httpx.Response(400, json=missing)).get(PATH) is None


def test_supabase_listing_asks_for_a_stable_order() -> None:
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json=[])

    list(_supabase(handler).list_objects())
    assert bodies[0]["sortBy"] == {"column": "name", "order": "asc"}


# ---------- backend keys ----------


def _jwt(claims: dict) -> str:
    def part(value: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()

    return f"{part({'alg': 'HS256', 'typ': 'JWT'})}.{part(claims)}.c2lnbmF0dXJl"


def test_service_key_kind_tells_backend_keys_from_public_ones() -> None:
    assert service_key_kind(_jwt({"role": "service_role", "iss": "supabase"})) == (
        "legacy_service_role"
    )
    assert service_key_kind("sb_secret_abc123") == "secret"
    assert service_key_kind(f"  {'sb_secret_abc123'}  ") == "secret"
    for public_or_bad in (
        _jwt({"role": "anon"}),
        _jwt({"role": "authenticated", "sub": USER}),
        "sb_publishable_abc123",
        "sb_secret_",
        "not.a.jwt",
        "service-key",
        "",
    ):
        assert service_key_kind(public_or_bad) is None


def test_storage_refuses_a_public_key_and_accepts_both_backend_kinds(
    configured: pytest.MonkeyPatch,
) -> None:
    configured.setattr(settings, "receipt_storage", "supabase")
    configured.setattr(settings, "supabase_url", "https://proj.supabase.co")
    for public in ("sb_publishable_abc123", _jwt({"role": "anon"})):
        storage_module.get_storage.cache_clear()
        configured.setattr(settings, "supabase_service_role_key", public)
        with pytest.raises(ApiError) as error:
            storage_module.get_storage()
        assert error.value.status == 503
    for backend in ("sb_secret_abc123", _jwt({"role": "service_role"})):
        storage_module.get_storage.cache_clear()
        configured.setattr(settings, "supabase_service_role_key", backend)
        assert isinstance(storage_module.get_storage(), SupabaseStorage)


# ---------- image checks ----------


def test_detect_format_by_content() -> None:
    assert images.detect_format(b"\xff\xd8\xff\xe0rest") == "JPEG"
    assert images.detect_format(PNG) == "PNG"
    assert images.detect_format(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "WEBP"
    for bad in (b"", b"%PDF-1.7", b"GIF89a"):
        with pytest.raises(ApiError):
            images.detect_format(bad)


def test_detect_format_size_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "receipt_max_bytes", 10)
    with pytest.raises(ApiError) as error:
        images.detect_format(PNG)
    assert error.value.errors[0].code == "too_large"


# ---------- discount allocation ----------


def _line(total: str) -> ReceiptLine:
    value = Decimal(total)
    return ReceiptLine("x", Decimal("1"), None, value, Decimal("0"), value)


def test_allocate_discount_keeps_centavos_exact() -> None:
    lines = allocate_discount([_line("77.50"), _line("54.00"), _line("650.00")], Decimal("130.00"))
    assert sum(line.line_total for line in lines) == Decimal("651.50")
    assert sum(line.discount for line in lines) == Decimal("130.00")
    assert all(line.line_total >= 0 for line in lines)
    thirds = allocate_discount([_line("1.00")] * 3, Decimal("0.10"))
    assert sorted(line.discount for line in thirds) == [
        Decimal("0.03"),
        Decimal("0.03"),
        Decimal("0.04"),
    ]
    assert allocate_discount([_line("5.00")], Decimal("0")) == [_line("5.00")]


def test_fixture_hash_is_stable() -> None:
    # The emulator test picks this exact file from the gallery; regenerate both together.
    data = (FIXTURES / "zz-test-supermarket.png").read_bytes()
    assert hashlib.sha256(data).hexdigest() in FixtureOcr(FIXTURES)._texts
