"""Real test images for the receipt photo tests (Phase 8D.3). Not a test module.

Uploads are decoded and re-encoded (images.sanitize), so tests need real image files. The
fake OCR engines tell photos apart by their colour, which survives re-encoding.
"""

import io

from PIL import Image, ImageDraw
from PIL.PngImagePlugin import PngInfo

# Colours the fake OCR engines recognise (see `kind_of`).
RECEIPT = (250, 250, 250)
BLURRY = (128, 128, 128)
NOTES = (40, 60, 220)
OTHER = (230, 120, 30)

# EXIF tags
ORIENTATION = 0x0112
MAKE = 0x010F
GPS_IFD = 0x8825
GPS_SAMPLE = {1: "N", 2: (14.0, 35.0, 1.5), 3: "E", 4: (121.0, 2.0, 7.25)}
XMP = (
    b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/'
    b'22-rdf-syntax-ns#"><rdf:Description exif:GPSLatitude="14,35N"/></rdf:RDF></x:xmpmeta>'
)


def photo(
    color: tuple[int, int, int] = RECEIPT,
    size: tuple[int, int] = (64, 48),
    fmt: str = "JPEG",
    *,
    gps: bool = False,
    orientation: int | None = None,
    extras: bool = False,
    mode: str = "RGB",
) -> bytes:
    """A plain image. gps/orientation add EXIF; extras adds ICC, XMP and a comment/text."""
    image = Image.new(mode, size, color if mode == "RGB" else color[0])
    return encode(image, fmt, gps=gps, orientation=orientation, extras=extras)


def encode(
    image: Image.Image,
    fmt: str = "JPEG",
    *,
    gps: bool = False,
    orientation: int | None = None,
    extras: bool = False,
    **params,  # noqa: ANN003
) -> bytes:
    exif = Image.Exif()
    if gps:
        exif[MAKE] = "ZZ Test Phone"
        exif[GPS_IFD] = GPS_SAMPLE
    if orientation is not None:
        exif[ORIENTATION] = orientation
    if len(exif):
        params["exif"] = exif.tobytes()
    if extras:
        params["icc_profile"] = b"zz-test-icc-profile" * 4
        if fmt == "PNG":
            info = PngInfo()
            info.add_text("Comment", "ZZ secret note")
            info.add_text("GPS", "14.5833,121.0333")
            params["pnginfo"] = info
        else:
            params["xmp"] = XMP
        if fmt == "JPEG":
            params["comment"] = b"ZZ secret note"
    out = io.BytesIO()
    image.save(out, fmt, **params)
    return out.getvalue()


def stored_with_orientation(upright: Image.Image, orientation: int) -> Image.Image:
    """The pixels a camera stores so that applying `orientation` shows `upright`."""
    inverse = {
        3: Image.Transpose.ROTATE_180,
        6: Image.Transpose.ROTATE_90,
        8: Image.Transpose.ROTATE_270,
    }
    return upright.transpose(inverse[orientation])


def marked(size: tuple[int, int] = (60, 30)) -> Image.Image:
    """White image with a red block in its top-left corner (to check rotation)."""
    image = Image.new("RGB", size, (255, 255, 255))
    ImageDraw.Draw(image).rectangle((0, 0, size[0] // 4, size[1] // 4), fill=(220, 0, 0))
    return image


def text_page(size: tuple[int, int]) -> Image.Image:
    """Receipt-like page: dark text rows on light paper."""
    image = Image.new("RGB", size, (245, 243, 238))
    draw = ImageDraw.Draw(image)
    rows = ["ZZ TEST SUPERMARKET", "EGGS LARGE 12S   112.00", "TOTAL   366.35", "VAT 20.95"]
    font_size = max(10, size[1] // 18)
    for i, row in enumerate(rows * 4):
        draw.text(
            (size[0] // 12, font_size + i * font_size * 1.2),
            row,
            fill=(20, 24, 33),
            font_size=font_size,
        )
    return image


def padded_jpeg(size: int, color: tuple[int, int, int] = RECEIPT) -> bytes:
    """A valid JPEG of exactly `size` bytes (padding in COM segments after SOI)."""
    base = photo(color)
    missing = size - len(base)
    assert missing >= 4, "too small to pad"
    segments = []
    while missing > 0:
        total = min(missing, 65537)  # marker (2) + length (2) + at most 65533 bytes
        if 0 < missing - total < 4:  # leave room for a last segment of at least 4 bytes
            total -= 4
        segments.append(b"\xff\xfe" + (total - 2).to_bytes(2, "big") + b"z" * (total - 4))
        missing -= total
    data = base[:2] + b"".join(segments) + base[2:]
    assert len(data) == size, (len(data), size)
    return data


def kind_of(image: bytes) -> tuple[int, int, int]:
    """The (approximate) colour at the centre of an image."""
    with Image.open(io.BytesIO(image)) as decoded:
        rgb = decoded.convert("RGB")
        return rgb.getpixel((rgb.width // 2, rgb.height // 2))  # type: ignore[return-value]


def near(actual: tuple[int, ...], expected: tuple[int, ...], tolerance: int = 12) -> bool:
    return all(abs(a - e) <= tolerance for a, e in zip(actual, expected, strict=True))


def jpeg_markers(data: bytes) -> list[int]:
    """Marker bytes of a JPEG's header segments (up to the image data)."""
    assert data[:2] == b"\xff\xd8"
    markers, i = [], 2
    while i < len(data) - 4:
        assert data[i] == 0xFF, "not at a marker"
        marker = data[i + 1]
        markers.append(marker)
        if marker == 0xDA:  # start of scan: header segments end here
            return markers
        length = int.from_bytes(data[i + 2 : i + 4], "big")
        i += 2 + length
    return markers
