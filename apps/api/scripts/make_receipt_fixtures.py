"""Render the synthetic receipt texts in tests/fixtures/receipts/*.txt as PNG photos.

Development only. The fixture OCR provider (OCR_PROVIDER=fixture) recognises these exact
images and returns their .txt text, so the scan flow can be tested without Google Vision.
Every fixture is made up and prefixed "zz-test". Needs Pillow (not an API dependency):

  pip install pillow && python -m scripts.make_receipt_fixtures
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "receipts"
WIDTH, LINE, MARGIN = 720, 34, 40


def _font(size: int) -> ImageFont.ImageFont:
    for name in ("/System/Library/Fonts/Menlo.ttc", "DejaVuSansMono.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def render(text: str) -> Image.Image:
    lines = text.rstrip("\n").splitlines()
    image = Image.new("RGB", (WIDTH, MARGIN * 2 + LINE * len(lines) + 40), "#F7F5EE")
    draw = ImageDraw.Draw(image)
    font = _font(22)
    draw.text((MARGIN, 12), "SYNTHETIC TEST RECEIPT - NOT REAL", fill="#B91C1C", font=_font(16))
    for i, line in enumerate(lines):
        draw.text((MARGIN, MARGIN + 20 + i * LINE), line, fill="#1F2937", font=font)
    return image


def main() -> int:
    for text_file in sorted(FIXTURES.glob("*.txt")):
        target = text_file.with_suffix(".png")
        render(text_file.read_text()).save(target, optimize=True)
        print(f"Wrote {target.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
