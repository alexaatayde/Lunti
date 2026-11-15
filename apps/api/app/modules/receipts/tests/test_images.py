"""Phase 8D.3: receipt photos are validated, made upright, stripped of all metadata,
downscaled and re-encoded before storage or OCR (images.sanitize). Unit tests."""

import hashlib
import io
import threading
import time
from pathlib import Path

import pytest
from PIL import Image, ImageChops, ImageStat

from app.core.config import settings
from app.core.errors import ApiError
from app.modules.receipts import images
from app.modules.receipts.ocr import FixtureOcr
from app.modules.receipts.tests.imaging import (
    MAKE,
    RECEIPT,
    encode,
    jpeg_markers,
    kind_of,
    marked,
    near,
    padded_jpeg,
    photo,
    stored_with_orientation,
    text_page,
)

FIXTURES = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "receipts"
APP1, APP2, COM = 0xE1, 0xE2, 0xFE


def error_code(exc: pytest.ExceptionInfo[ApiError]) -> str:
    assert exc.value.status == 422
    return exc.value.errors[0].code


def decoded(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    image.load()
    return image


# ---------- accepted formats and validation ----------


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_jpeg_png_and_webp_become_a_jpeg(fmt: str) -> None:
    clean = images.sanitize(photo(fmt=fmt))
    assert clean.source_format == fmt
    assert (clean.ext, clean.content_type) == ("jpg", "image/jpeg")
    assert images.detect_format(clean.data) == "JPEG"
    assert decoded(clean.data).format == "JPEG"
    assert clean.sha256 == hashlib.sha256(clean.data).hexdigest()


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"", "empty"),
        (b"GIF89a" + b"\0" * 32, "unsupported_type"),
        (b"%PDF-1.7 not an image", "unsupported_type"),
        (b"<svg xmlns='http://www.w3.org/2000/svg'/>", "unsupported_type"),
        (b"BM" + b"\0" * 64, "unsupported_type"),  # BMP
    ],
    ids=["empty", "gif", "pdf", "svg", "bmp"],
)
def test_other_types_are_refused(data: bytes, code: str) -> None:
    with pytest.raises(ApiError) as exc:
        images.sanitize(data)
    assert error_code(exc) == code


@pytest.mark.parametrize(
    "data",
    [
        b"\xff\xd8\xff\xe0" + b"receipt-photo",  # JPEG signature, no image
        b"\x89PNG\r\n\x1a\n" + b"\0" * 40,  # PNG signature, garbage chunks
        b"RIFF\x10\0\0\0WEBPVP8 " + b"\0" * 20,  # WebP signature, no image
        photo()[:-200],  # truncated JPEG
        photo(fmt="PNG")[:-30],  # truncated PNG
        b"\xff\xd8\xff\xe0" + b"<?php system($_GET['c']); ?>",  # script behind a signature
    ],
    ids=[
        "jpeg-magic-only",
        "png-garbage",
        "webp-magic-only",
        "truncated-jpeg",
        "truncated-png",
        "disguised-script",
    ],
)
def test_files_that_do_not_decode_are_refused(data: bytes) -> None:
    with pytest.raises(ApiError) as exc:
        images.sanitize(data)
    assert error_code(exc) == "unreadable_image"


def test_declared_format_must_match_content() -> None:
    # A PNG body behind a JPEG signature: decoded only as what its signature says.
    with pytest.raises(ApiError) as exc:
        images.sanitize(b"\xff\xd8\xff" + photo(fmt="PNG"))
    assert error_code(exc) == "unreadable_image"


def test_size_limit_is_checked_before_decoding(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "receipt_max_bytes", 50_000)
    images.sanitize(padded_jpeg(50_000))  # at the limit: fine
    with pytest.raises(ApiError) as exc:
        images.sanitize(padded_jpeg(50_001))
    assert error_code(exc) == "too_large"


def test_input_limit_stays_10_mb() -> None:
    assert settings.receipt_max_bytes == 10 * 1024 * 1024


def test_huge_dimensions_are_refused_from_the_header() -> None:
    # 6000 x 5000 single-colour PNG: tiny file, 30 MP decoded (over the 24 MP PNG limit).
    bomb = encode(Image.new("L", (6000, 5000), 255), "PNG")
    assert len(bomb) < 200_000
    with pytest.raises(ApiError) as exc:
        images.sanitize(bomb)
    assert error_code(exc) == "too_many_pixels"


def test_pixel_limit_per_format(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(images.MAX_SOURCE_PIXELS, "JPEG", 100 * 100)
    images.sanitize(photo(size=(100, 100)))
    with pytest.raises(ApiError) as exc:
        images.sanitize(photo(size=(101, 100)))
    assert error_code(exc) == "too_many_pixels"


def test_pillow_bomb_warning_is_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    # If our own limit were ever raised past Pillow's, Pillow's warning still refuses it.
    monkeypatch.setitem(images.MAX_SOURCE_PIXELS, "PNG", 10**9)
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)
    with pytest.raises(ApiError) as exc:
        images.sanitize(photo(size=(40, 40), fmt="PNG"))
    assert error_code(exc) == "unreadable_image"


def test_decoding_runs_at_most_two_at_a_time(monkeypatch: pytest.MonkeyPatch) -> None:
    active, peak, lock = 0, 0, threading.Lock()
    original = images._upright

    def slow_upright(image: Image.Image) -> Image.Image:
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.05)
        with lock:
            active -= 1
        return original(image)

    monkeypatch.setattr(images, "_upright", slow_upright)
    data = photo()
    threads = [threading.Thread(target=images.sanitize, args=(data,)) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert peak == images.DECODE_SLOTS == 2


# ---------- metadata ----------


def test_jpeg_exif_gps_icc_xmp_and_comment_are_removed() -> None:
    original = photo(gps=True, extras=True)
    source = decoded(original)
    assert source.getexif().get_ifd(0x8825)  # the input really has GPS
    assert {"exif", "icc_profile", "comment", "xmp"} <= set(source.info)

    clean = images.sanitize(original)
    out = decoded(clean.data)
    assert dict(out.getexif()) == {}
    assert not ({"exif", "icc_profile", "comment", "xmp"} & set(out.info))
    markers = jpeg_markers(clean.data)
    assert APP1 not in markers and APP2 not in markers and COM not in markers
    for secret in (b"Exif", b"ZZ Test Phone", b"ZZ secret", b"xmpmeta", b"zz-test-icc"):
        assert secret not in clean.data


def test_webp_exif_and_xmp_are_removed() -> None:
    clean = images.sanitize(photo(fmt="WEBP", gps=True, extras=True))
    out = decoded(clean.data)
    assert dict(out.getexif()) == {} and "xmp" not in out.info and "exif" not in out.info
    assert b"Exif" not in clean.data and b"xmpmeta" not in clean.data


def test_png_text_chunks_and_exif_are_removed() -> None:
    original = photo(fmt="PNG", gps=True, extras=True)
    assert "GPS" in decoded(original).info
    clean = images.sanitize(original)
    out = decoded(clean.data)
    assert dict(out.getexif()) == {} and "GPS" not in out.info and "Comment" not in out.info
    assert b"14.5833" not in clean.data and b"ZZ secret" not in clean.data


def test_camera_make_is_never_kept() -> None:
    clean = images.sanitize(photo(gps=True))
    assert MAKE not in decoded(clean.data).getexif()


# ---------- orientation, size, colour ----------


@pytest.mark.parametrize("orientation", [3, 6, 8])
def test_exif_orientation_is_applied_to_the_pixels(orientation: int) -> None:
    upright = marked((60, 30))
    data = encode(stored_with_orientation(upright, orientation), orientation=orientation)
    out = decoded(images.sanitize(data).data)
    assert out.size == (60, 30)  # landscape again
    assert near(out.getpixel((2, 2)), (220, 0, 0), 40)  # red block back in the top-left
    assert near(out.getpixel((57, 27)), (255, 255, 255), 20)
    assert dict(out.getexif()) == {}  # the orientation tag is gone too


def test_broken_exif_does_not_refuse_a_valid_photo(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(image: Image.Image) -> Image.Image:
        raise ValueError("corrupt EXIF")

    monkeypatch.setattr(images.ImageOps, "exif_transpose", broken)
    clean = images.sanitize(photo(orientation=6))
    assert decoded(clean.data).size == (64, 48)


@pytest.mark.parametrize(
    ("size", "fmt", "expected"),
    [
        ((4000, 1000), "JPEG", (2000, 500)),
        ((4100, 3000), "JPEG", (2000, 1463)),  # decoded at half scale, then resized
        ((3000, 2500), "PNG", (2000, 1667)),
        ((1200, 2400), "WEBP", (1000, 2000)),
        ((800, 600), "JPEG", (800, 600)),  # never enlarged
    ],
)
def test_long_edge_is_at_most_2000_px(
    size: tuple[int, int], fmt: str, expected: tuple[int, int]
) -> None:
    clean = images.sanitize(photo(size=size, fmt=fmt))
    assert (clean.width, clean.height) == expected == decoded(clean.data).size


def test_transparency_is_flattened_onto_white() -> None:
    clean = images.sanitize(photo((0, 0, 0, 0), fmt="PNG", mode="RGBA"))  # type: ignore[arg-type]
    assert near(kind_of(clean.data), (255, 255, 255), 6)


def test_16_bit_png_is_scaled_not_clipped() -> None:
    data = encode(Image.new("I;16", (40, 30), 32768), "PNG")
    value = decoded(images.sanitize(data).data).getpixel((20, 15))
    assert abs(value - 128) <= 3  # mid-grey, not white


def test_grayscale_stays_grayscale_and_cmyk_becomes_rgb() -> None:
    assert decoded(images.sanitize(photo(mode="L")).data).mode == "L"
    cmyk = encode(Image.new("CMYK", (40, 30), (0, 0, 0, 0)), "JPEG")
    out = decoded(images.sanitize(cmyk).data)
    assert out.mode == "RGB" and near(out.getpixel((20, 15)), (255, 255, 255), 8)


def test_animated_images_keep_their_first_frame() -> None:
    frames = [Image.new("RGB", (40, 30), c) for c in ((220, 0, 0), (0, 0, 220))]
    out = io.BytesIO()
    frames[0].save(out, "PNG", save_all=True, append_images=frames[1:])
    assert near(kind_of(images.sanitize(out.getvalue()).data), (220, 0, 0), 20)


def test_output_is_deterministic_for_identical_input() -> None:
    data = photo((12, 200, 99), size=(300, 200), gps=True)
    first, second = images.sanitize(data), images.sanitize(data)
    assert first.data == second.data and first.sha256 == second.sha256
    assert images.sanitize(photo((13, 200, 99), size=(300, 200))).sha256 != first.sha256


# ---------- readability ----------


def test_rotated_resized_compressed_text_stays_readable() -> None:
    """A 12 MP portrait 'phone photo' of a receipt, stored sideways with EXIF orientation 6:
    the result must match an ideal resize of the upright page closely (no smearing, no
    wrong rotation) while being far smaller than the input."""
    upright = text_page((3024, 4032))
    data = encode(stored_with_orientation(upright, 6), orientation=6, gps=True, quality=92)
    clean = images.sanitize(data)
    assert (clean.width, clean.height) == (1500, 2000)
    assert len(clean.data) < len(data) / 2

    reference = upright.resize((1500, 2000), Image.Resampling.LANCZOS).convert("L")
    result = decoded(clean.data).convert("L")
    difference = ImageStat.Stat(ImageChops.difference(reference, result)).mean[0]
    assert difference < 4  # mean grey-level error out of 255
    # Text pixels survive: the dark/light contrast of the page is preserved.
    low, high = result.getextrema()
    assert low < 60 and high > 220


def test_development_fixtures_still_match_after_sanitising() -> None:
    fixture_ocr = FixtureOcr(FIXTURES)
    raw = (FIXTURES / "zz-test-supermarket.png").read_bytes()
    result = fixture_ocr.read(images.sanitize(raw).data)
    assert result.confidence and "ZZ TEST SUPERMARKET" in result.text
    assert fixture_ocr.read(raw).confidence  # the original file still matches too
    assert fixture_ocr.read(images.sanitize(photo(RECEIPT)).data).text == ""
