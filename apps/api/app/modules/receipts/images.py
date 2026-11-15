"""Receipt photo sanitising (Phase 8D.3; SRS 3.5.4, RA 10173 data minimisation).

Every uploaded photo is decoded and re-encoded before it is stored or read by OCR, so neither
storage nor an OCR provider ever receives the original file:

- Accepted inputs: JPEG, PNG or WebP (judged by content, never the client's declared type),
  at most RECEIPT_MAX_BYTES, and at most MAX_SOURCE_PIXELS for its format.
- The photo must decode completely; truncated, corrupt or disguised files are refused.
- EXIF orientation is applied to the pixels, then ALL metadata is dropped: EXIF (including
  GPS location and camera details), XMP, ICC profiles, comments and PNG text chunks.
- Transparency is flattened onto white; animated images keep their first frame.
- The long edge is reduced to at most MAX_EDGE px (never enlarged).
- The result is always a baseline JPEG (`.jpg`, `image/jpeg`): the stored object, its
  Content-Type and `receipts.image_path` all say JPEG.

Encoding is deterministic for a given Pillow version, so a retried upload of the same file
produces byte-identical output (used to tell an identical retry from a different photo).

Memory: JPEGs are decoded at a reduced scale when they are much larger than MAX_EDGE, pixel
counts are checked from the header before any pixel data is decoded, and at most
DECODE_SLOTS photos are decoded at once per API process.
"""

import hashlib
import io
import logging
import threading
import warnings
from dataclasses import dataclass
from functools import cached_property

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings
from app.core.errors import invalid_field

logger = logging.getLogger(__name__)

MAX_EDGE = 2000
JPEG_QUALITY = 85
OUTPUT_EXT = "jpg"
OUTPUT_CONTENT_TYPE = "image/jpeg"

# Decoded size limits. JPEGs can be decoded at 1/2–1/8 scale (Image.draft), so they may be
# larger; PNG and WebP decode at full size (about 4 bytes per pixel).
MAX_SOURCE_PIXELS = {"JPEG": 50_000_000, "PNG": 24_000_000, "WEBP": 24_000_000}

DECODE_SLOTS = 2
_decode_slots = threading.BoundedSemaphore(DECODE_SLOTS)

_ALPHA_MODES = {"RGBA", "LA", "PA", "RGBa", "La"}
_HIGH_BIT_MODES = {"I", "I;16", "I;16B", "I;16L", "I;16N"}

# Raised by Pillow (or its codecs) for files that are not valid images of the sniffed type.
_DECODE_ERRORS = (
    UnidentifiedImageError,
    Image.DecompressionBombError,
    Image.DecompressionBombWarning,
    OSError,
    SyntaxError,
    ValueError,
    EOFError,
    IndexError,
    KeyError,
    TypeError,
    MemoryError,
)


@dataclass(frozen=True)
class CleanImage:
    data: bytes
    width: int
    height: int
    source_format: str  # JPEG, PNG or WEBP
    ext: str = OUTPUT_EXT
    content_type: str = OUTPUT_CONTENT_TYPE

    @cached_property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


def detect_format(data: bytes) -> str:
    """JPEG, PNG or WEBP from the file's first bytes; anything else is refused (422)."""
    if not data:
        raise invalid_field("image", "The image is empty.", "empty")
    if len(data) > settings.receipt_max_bytes:
        mb = settings.receipt_max_bytes // (1024 * 1024)
        raise invalid_field("image", f"The image is larger than {mb} MB.", "too_large")
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    raise invalid_field("image", "Use a JPEG, PNG or WebP photo.", "unsupported_type")


def sanitize(data: bytes) -> CleanImage:
    """Validated, metadata-free, upright JPEG of at most MAX_EDGE px (422 if unusable)."""
    source_format = detect_format(data)
    with _decode_slots:
        try:
            with warnings.catch_warnings():
                # Pillow's own bomb check is a warning below 2x its limit: make it an error.
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data), formats=[source_format]) as source:
                    width, height = source.size
                    if width < 1 or height < 1:
                        raise _unreadable()
                    if width * height > MAX_SOURCE_PIXELS[source_format]:
                        raise invalid_field(
                            "image",
                            "The photo's resolution is too high. Use a smaller photo.",
                            "too_many_pixels",
                        )
                    if source_format == "JPEG":
                        source.draft(None, _target_size(width, height))
                    source.load()  # decodes everything: truncated/corrupt files fail here
                    image = _upright(source)
                    image = _to_jpeg_mode(image)
                    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
                    image.info.clear()  # nothing from the original rides along
                    out = io.BytesIO()
                    image.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True)
        except _DECODE_ERRORS as exc:
            logger.info("Receipt photo refused: %s", exc.__class__.__name__)
            raise _unreadable() from exc
    return CleanImage(
        data=out.getvalue(),
        width=image.width,
        height=image.height,
        source_format=source_format,
    )


def _unreadable():  # noqa: ANN202 - returns an ApiError to raise
    return invalid_field(
        "image",
        "We couldn't read this photo. Take a new photo or choose another one.",
        "unreadable_image",
    )


def _target_size(width: int, height: int) -> tuple[int, int]:
    """Smallest size draft() may decode to: the long edge stays >= MAX_EDGE."""
    long_edge = max(width, height)
    if long_edge <= MAX_EDGE:
        return width, height
    scale = MAX_EDGE / long_edge
    return max(1, round(width * scale)), max(1, round(height * scale))


def _upright(image: Image.Image) -> Image.Image:
    """Apply the EXIF orientation to the pixels. A broken EXIF block is ignored (the
    metadata is dropped anyway), never a reason to refuse an otherwise valid photo."""
    try:
        return ImageOps.exif_transpose(image)
    except Exception:  # noqa: BLE001
        logger.info("Receipt photo has unreadable EXIF; orientation left as stored")
        return image.copy()


def _to_jpeg_mode(image: Image.Image) -> Image.Image:
    """L (grayscale) or RGB, which baseline JPEG can hold."""
    if image.mode == "L":
        return image
    if image.mode in _HIGH_BIT_MODES:  # 16-bit PNG: scale to 8 bits instead of clipping
        return image.convert("I").point(lambda value: value * (1 / 256)).convert("L")
    if image.mode == "1":
        return image.convert("L")
    if image.mode in _ALPHA_MODES or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        flat = Image.new("RGB", rgba.size, "white")
        flat.paste(rgba, mask=rgba.getchannel("A"))
        return flat
    return image.convert("RGB")
