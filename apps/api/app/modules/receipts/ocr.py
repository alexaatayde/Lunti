"""OCR adapters (AGENTS.md §7.1 step 2).

- `GoogleVisionOcr` (production): Google Cloud Vision DOCUMENT_TEXT_DETECTION with a service
  account key file. Words are regrouped into printed rows by position, so a receipt's item
  name and price end up on one line even when Vision returns the columns as separate blocks.
- `FixtureOcr` (development/testing only): returns the stored text for known synthetic
  receipt images (`<name>.png|jpg` next to `<name>.txt` in OCR_FIXTURE_DIR). Any other image
  reads as blank, which exercises the "couldn't read" path. Results are marked simulated.

There is no fallback between them: a misconfigured provider is an error (503), never a
silent switch to fixture text. Without OCR_PROVIDER a development API has OCR disabled
(503), so the paid service is only ever called when configured explicitly.

The engines do no database work. The upload service calls `read` only after it has committed
its state and released its database connection (service.upload_receipt).
"""

import hashlib
import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from statistics import median
from typing import Protocol

from app.core.config import settings
from app.core.errors import ApiError
from app.modules.receipts import images, ocr_config

logger = logging.getLogger(__name__)

GOOGLE_VISION = "google_vision"
FIXTURE = "fixture"
# Engines whose requests are billed: they use the app-wide daily allowance (quota.py).
EXTERNAL_ENGINES = frozenset({GOOGLE_VISION})


class OcrUnavailable(Exception):
    """The OCR service couldn't be reached or refused the request (temporary; retryable)."""


@dataclass(frozen=True)
class OcrResult:
    text: str
    # Mean word confidence in 0–1 (None when the engine doesn't report one).
    confidence: float | None
    engine: str

    @property
    def simulated(self) -> bool:
        return self.engine != GOOGLE_VISION


class OcrEngine(Protocol):
    name: str

    def read(self, image: bytes) -> OcrResult: ...


# ---------- row reconstruction ----------


@dataclass(frozen=True)
class Word:
    text: str
    x0: float
    x1: float
    y0: float
    y1: float
    confidence: float = 1.0

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def height(self) -> float:
        return max(self.y1 - self.y0, 1.0)


def rows_from_words(words: list[Word]) -> list[str]:
    """Groups words whose vertical centers are close into one printed row, left to right.
    A wide horizontal gap (a column break) is kept as three spaces."""
    if not words:
        return []
    tolerance = median(w.height for w in words) * 0.6
    rows: list[list[Word]] = []
    for word in sorted(words, key=lambda w: (w.cy, w.x0)):
        for row in rows:
            center = sum(w.cy for w in row) / len(row)
            if abs(word.cy - center) <= tolerance:
                row.append(word)
                break
        else:
            rows.append([word])
    rows.sort(key=lambda row: sum(w.cy for w in row) / len(row))

    lines: list[str] = []
    for row in rows:
        row.sort(key=lambda w: w.x0)
        char_width = median((w.x1 - w.x0) / max(len(w.text), 1) for w in row)
        parts = [row[0].text]
        for prev, word in zip(row, row[1:], strict=False):
            gap = word.x0 - prev.x1
            parts.append(
                "   "
                if gap > char_width * 2.5
                else ("" if gap < char_width * 0.3 and _joins(prev, word) else " ")
            )
            parts.append(word.text)
        lines.append("".join(parts).strip())
    return lines


def _joins(prev: Word, word: Word) -> bool:
    """Vision splits "89.50" into "89", ".", "50"; glue punctuation back without spaces."""
    return word.text[:1] in ".,:%)/" or prev.text[-1:] in "(@/₱.,"


# ---------- Google Cloud Vision ----------


class GoogleVisionOcr:
    """One DOCUMENT_TEXT_DETECTION request per `read`: a fixed timeout and no automatic
    retries, so each call is at most one billed request and finishes within the upload's
    lease. Errors never carry receipt text or credentials into logs."""

    name = GOOGLE_VISION

    def __init__(
        self, credentials_file: str | None = None, *, timeout: float | None = None
    ) -> None:
        from google.cloud import vision

        if credentials_file:
            from google.oauth2 import service_account

            credentials = service_account.Credentials.from_service_account_file(credentials_file)
            client = vision.ImageAnnotatorClient(credentials=credentials)
        else:  # keyless: the runtime's application default credentials
            client = vision.ImageAnnotatorClient()
        self._vision = vision
        self._client = client
        self.timeout = timeout if timeout is not None else settings.ocr_timeout_seconds

    def read(self, image: bytes) -> OcrResult:
        from google.api_core import exceptions as google_errors

        try:
            response = self._client.document_text_detection(
                image=self._vision.Image(content=image),
                image_context={"language_hints": ["en", "fil"]},
                timeout=self.timeout,
                retry=None,  # never resend: each attempt may be billed (quota.py)
            )
        except google_errors.GoogleAPICallError as exc:
            logger.warning("Vision request failed: %s", exc.__class__.__name__)
            raise OcrUnavailable(exc.__class__.__name__) from None
        except Exception as exc:  # transport errors (DNS, TLS, timeouts)
            logger.warning("Vision request failed: %s", exc.__class__.__name__)
            raise OcrUnavailable(exc.__class__.__name__) from None
        if response.error.message:
            logger.warning("Vision returned an error (code %s)", response.error.code)
            raise OcrUnavailable(f"vision error code {response.error.code}")
        return self._to_result(response.full_text_annotation)

    def _to_result(self, annotation) -> OcrResult:  # noqa: ANN001 (protobuf message)
        words: list[Word] = []
        for page in annotation.pages:
            for block in page.blocks:
                for paragraph in block.paragraphs:
                    for word in paragraph.words:
                        text = "".join(symbol.text for symbol in word.symbols)
                        xs = [v.x for v in word.bounding_box.vertices]
                        ys = [v.y for v in word.bounding_box.vertices]
                        if not text or not xs:
                            continue
                        words.append(
                            Word(text, min(xs), max(xs), min(ys), max(ys), word.confidence)
                        )
        if not words:
            return OcrResult(text=annotation.text or "", confidence=None, engine=self.name)
        confidence = sum(w.confidence for w in words) / len(words)
        return OcrResult(
            text="\n".join(rows_from_words(words)), confidence=confidence, engine=self.name
        )


# ---------- development fixtures ----------

IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")
FIXTURE_CONFIDENCE = 0.95


class FixtureOcr:
    """Development/testing only. Matches an uploaded image byte-for-byte (SHA-256) to a
    synthetic receipt image and returns that receipt's stored text. OCR receives the
    sanitised photo (images.sanitize), so each fixture is indexed under the hash of its
    sanitised form as well as its original bytes."""

    name = FIXTURE

    def __init__(self, directory: Path) -> None:
        self._texts: dict[str, str] = {}
        for image in sorted(directory.iterdir()) if directory.is_dir() else []:
            text_file = image.with_suffix(".txt")
            if image.suffix.lower() in IMAGE_SUFFIXES and text_file.exists():
                raw = image.read_bytes()
                text = text_file.read_text()
                self._texts[hashlib.sha256(raw).hexdigest()] = text
                self._texts[images.sanitize(raw).sha256] = text

    def read(self, image: bytes) -> OcrResult:
        text = self._texts.get(hashlib.sha256(image).hexdigest())
        if text is None:
            return OcrResult(text="", confidence=None, engine=self.name)
        return OcrResult(text=text, confidence=FIXTURE_CONFIDENCE, engine=self.name)


# ---------- dependency ----------


def _not_configured(detail: str) -> ApiError:
    logger.error("Receipt OCR misconfigured: %s", detail)
    return ApiError(503, "service-unavailable", "Receipt scanning isn't available right now.")


def is_external(engine: OcrEngine) -> bool:
    return engine.name in EXTERNAL_ENGINES


@lru_cache
def get_ocr() -> OcrEngine:
    """FastAPI dependency (tests override it). Never falls back to another provider."""
    provider = settings.resolved_ocr_provider
    if provider == "disabled":
        logger.info("Receipt OCR is disabled (set OCR_PROVIDER to enable it)")
        raise ApiError(503, "service-unavailable", "Receipt scanning isn't available right now.")
    if provider == "google":
        problems = ocr_config.errors(ocr_config.check_settings(settings))
        if problems:
            # Names the failed checks only; never paths' contents or key material.
            raise _not_configured("; ".join(f"{p.check}: {p.detail}" for p in problems))
        if settings.google_vision_auth.strip().lower() == "application_default":
            return GoogleVisionOcr()
        return GoogleVisionOcr(settings.google_application_credentials)
    if provider == "fixture":
        if settings.is_production:
            raise _not_configured("fixture OCR is refused when APP_ENV=production")
        logger.warning("Receipt OCR uses development fixtures (simulated results)")
        return FixtureOcr(Path(settings.ocr_fixture_dir))
    raise _not_configured(f"unknown OCR_PROVIDER {provider!r}")
