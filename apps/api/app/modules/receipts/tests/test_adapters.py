"""OCR and storage adapters, image checks and discount allocation (no database)."""

import hashlib
import json
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace as NS

import httpx
import pytest

from app.core.config import settings
from app.core.errors import ApiError
from app.modules.expenses.transaction_service import ReceiptLine
from app.modules.receipts import ocr as ocr_module
from app.modules.receipts import storage as storage_module
from app.modules.receipts.ocr import (
    FixtureOcr,
    GoogleVisionOcr,
    OcrUnavailable,
    Word,
    rows_from_words,
)
from app.modules.receipts.service import allocate_discount, sniff_image
from app.modules.receipts.storage import LocalStorage, StorageUnavailable, SupabaseStorage

FIXTURES = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "receipts"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 20


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
    engine._client = NS(document_text_detection=lambda **_: response)
    return engine


def test_vision_result_has_rows_and_mean_confidence() -> None:
    result = _vision([_vision_word("MILK", 0, 0, 0.9), _vision_word("90.50", 200, 1, 0.7)]).read(
        b"img"
    )
    assert result.text == "MILK   90.50"
    assert result.confidence == pytest.approx(0.8)
    assert result.engine == "google_vision" and not result.simulated


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
    storage.put("u/r.jpg", b"jpeg", "image/jpeg")
    url = storage.signed_url("u/r.jpg")
    storage.delete("u/r.jpg")

    upload, sign, delete = seen
    assert upload.method == "POST" and upload.url.path == "/storage/v1/object/receipts/u/r.jpg"
    assert upload.headers["authorization"] == "Bearer service-key"
    assert upload.headers["x-upsert"] == "false" and upload.content == b"jpeg"
    assert json.loads(sign.content) == {"expiresIn": 600}
    assert url == "https://proj.supabase.co/storage/v1/object/sign/receipts/u/r.jpg?token=t"
    assert delete.method == "DELETE"


def test_supabase_errors_are_unavailable_and_missing_delete_is_ok() -> None:
    storage = _supabase(lambda request: httpx.Response(500))
    with pytest.raises(StorageUnavailable):
        storage.put("u/r.jpg", b"x", "image/jpeg")
    _supabase(lambda request: httpx.Response(404)).delete("u/gone.jpg")

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    with pytest.raises(StorageUnavailable):
        _supabase(down).signed_url("u/r.jpg")


def test_local_storage_never_overwrites_or_escapes(tmp_path: Path) -> None:
    storage = LocalStorage(tmp_path)
    storage.put("user/a.png", PNG, "image/png")
    assert (tmp_path / "user" / "a.png").read_bytes() == PNG
    with pytest.raises(StorageUnavailable):
        storage.put("user/a.png", b"other", "image/png")
    with pytest.raises(ValueError):
        storage.put("../outside.png", PNG, "image/png")
    storage.delete("user/a.png")
    storage.delete("user/a.png")  # already gone: fine
    assert storage.signed_url("user/a.png") is None


# ---------- image checks ----------


def test_sniff_image_by_content() -> None:
    assert sniff_image(b"\xff\xd8\xff\xe0rest") == ("jpg", "image/jpeg")
    assert sniff_image(PNG) == ("png", "image/png")
    assert sniff_image(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == ("webp", "image/webp")
    for bad in (b"", b"%PDF-1.7", b"GIF89a"):
        with pytest.raises(ApiError):
            sniff_image(bad)


def test_sniff_image_size_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "receipt_max_bytes", 10)
    with pytest.raises(ApiError) as error:
        sniff_image(PNG)
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
