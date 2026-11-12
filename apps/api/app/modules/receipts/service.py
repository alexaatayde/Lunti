"""Receipt pipeline: upload → OCR → draft → user confirms → transaction (AGENTS.md §7.1).

Rules this module enforces:
- A draft is never a transaction. Only `confirm` writes financial records, in one database
  transaction with the line items, the receipt status and the budget recalculation.
- Uploads are idempotent: the app sends its own id for each image (`client_id`, used as the
  receipt id), so a retried upload returns the same receipt instead of a second one.
- Confirmations are idempotent: the receipt row is locked, a confirmed receipt returns the
  transaction it already produced, and `transactions.receipt_id` is unique.
- Every query filters by the caller's user_id; RLS applies too. Another user's receipt is
  "not found".

The draft is not stored as columns: it is rebuilt from `ocr_raw_text` by the deterministic
parser, with the per-field confidences stored at upload time.
"""

import logging
from datetime import UTC, datetime
from decimal import ROUND_DOWN, Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.errors import ApiError, FieldError, invalid_field, not_found
from app.modules.expenses import periods, transaction_service
from app.modules.expenses import service as categories_service
from app.modules.expenses.schemas import CategoryRef
from app.modules.receipts import parser
from app.modules.receipts.models import Receipt
from app.modules.receipts.ocr import FIXTURE, GOOGLE_VISION, OcrEngine, OcrUnavailable
from app.modules.receipts.schemas import (
    Confidence,
    DraftItem,
    FailureReason,
    ReceiptConfirm,
    ReceiptConfirmed,
    ReceiptDraft,
    ReviewFlag,
)
from app.modules.receipts.schemas import Receipt as ReceiptOut
from app.modules.receipts.storage import ReceiptStorage, StorageUnavailable

logger = logging.getLogger(__name__)

# First line of `ocr_raw_text` for development fixture results, so a simulated draft stays
# labelled as simulated when it is read back later.
SIMULATED_MARKER = "[lunti:simulated-ocr]"
MIN_TEXT_CHARS = 10
LOW_CONFIDENCE = 0.8
CENT = Decimal("0.01")

IMAGE_TYPES = {  # magic bytes → (file extension, content type)
    b"\xff\xd8\xff": ("jpg", "image/jpeg"),
    b"\x89PNG\r\n\x1a\n": ("png", "image/png"),
}


# ---------- helpers ----------


def sniff_image(data: bytes) -> tuple[str, str]:
    """Accept only JPEG, PNG or WebP, judged by content (not the client's declared type)."""
    if not data:
        raise invalid_field("image", "The image is empty.", "empty")
    if len(data) > settings.receipt_max_bytes:
        mb = settings.receipt_max_bytes // (1024 * 1024)
        raise invalid_field("image", f"The image is larger than {mb} MB.", "too_large")
    for magic, kind in IMAGE_TYPES.items():
        if data.startswith(magic):
            return kind
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    raise invalid_field("image", "Use a JPEG, PNG or WebP photo.", "unsupported_type")


def _get_own(
    db: Session, user: CurrentUser, receipt_id: UUID, *, lock: bool = False
) -> Receipt | None:
    stmt = select(Receipt).where(Receipt.id == receipt_id, Receipt.user_id == user.id)
    if lock:
        stmt = stmt.with_for_update()
    return db.scalar(stmt)


def _require_own(
    db: Session, user: CurrentUser, receipt_id: UUID, *, lock: bool = False
) -> Receipt:
    row = _get_own(db, user, receipt_id, lock=lock)
    if row is None:
        raise not_found("Receipt")
    return row


def _split_marker(raw: str | None) -> tuple[str, str | None]:
    """(OCR text, engine) from the stored raw text."""
    if raw is None:
        return "", None
    if raw.startswith(SIMULATED_MARKER):
        return raw[len(SIMULATED_MARKER) :].lstrip("\n"), FIXTURE
    return raw, GOOGLE_VISION


def _parse(text: str) -> parser.ParsedReceipt:
    return parser.parse(text, today=periods.local_today(), tz=periods.app_tz())


def _pct(value: Decimal | None) -> int:
    return 0 if value is None else int((value * 100).to_integral_value())


def _confidence(value: float) -> Decimal:
    return Decimal(str(round(min(max(value, 0.0), 1.0), 3)))


def _failure_reason(text: str, parsed: parser.ParsedReceipt) -> FailureReason:
    if len(text.strip()) < MIN_TEXT_CHARS:
        return "unreadable"
    if not parsed.has_money:
        return "no_amounts"
    return "unreadable"  # low OCR confidence


def _suggested_category(db: Session, user: CurrentUser) -> CategoryRef | None:
    """Receipts are grocery receipts first; the user can pick another category."""
    categories = categories_service.list_categories(db, user)
    chosen = next((c for c in categories if c.icon == "groceries"), None) or next(
        iter(categories), None
    )
    return CategoryRef.model_validate(chosen) if chosen else None


# ---------- reading ----------


def to_out(db: Session, user: CurrentUser, row: Receipt, storage: ReceiptStorage) -> ReceiptOut:
    text, engine = _split_marker(row.ocr_raw_text)
    parsed = _parse(text) if text else None

    image_url = None
    if row.ocr_status in ("draft", "confirmed"):
        try:
            image_url = storage.signed_url(row.image_path)
        except StorageUnavailable:
            image_url = None  # the review still works without the picture

    base = {
        "id": row.id,
        "status": row.ocr_status,
        "created_at": row.created_at,
        "ocr_engine": engine,
        "simulated": engine == FIXTURE,
        "image_url": image_url,
        "suggested_category": _suggested_category(db, user),
        "transaction_id": None,
        "possible_duplicate": None,
    }
    if row.ocr_status == "confirmed":
        saved = transaction_service.saved_for_receipt(db, user, row.id)
        base["transaction_id"] = saved.id if saved else None
    if row.ocr_status in ("failed", "processing") or parsed is None:
        return ReceiptOut(
            **base,
            failure_reason=_failure_reason(text, parsed or _parse(""))
            if row.ocr_status == "failed"
            else None,
            draft=None,
            confidence=None,
            flags=[],
        )

    confidence = Confidence(
        store=_pct(row.confidence_store),
        items=_pct(row.confidence_items),
        total=_pct(row.confidence_total),
    )
    flags = [ReviewFlag(field=f.field, code=f.code, message=f.message) for f in parsed.flags]
    flagged = {f.field for f in flags}
    for name, value, present in (
        ("merchant", row.confidence_store, parsed.merchant is not None),
        ("total", row.confidence_total, parsed.total is not None),
        ("items", row.confidence_items, bool(parsed.items)),
    ):
        if present and name not in flagged and (value or 0) < Decimal(str(LOW_CONFIDENCE)):
            flags.append(ReviewFlag(field=name, code="low_confidence", message="Check this."))

    if row.ocr_status == "draft" and parsed.total is not None and parsed.occurred_at:
        base["possible_duplicate"] = transaction_service.find_same_day(
            db, user, amount=parsed.total, day=periods.local_date(parsed.occurred_at)
        )

    draft = ReceiptDraft(
        merchant=parsed.merchant,
        occurred_at=parsed.occurred_at,
        total=parsed.total,
        subtotal=parsed.subtotal,
        discount=parsed.discount,
        vat=parsed.vat,
        items=[
            DraftItem(
                name=i.name,
                quantity=i.quantity,
                unit=i.unit,
                unit_price=i.unit_price,
                discount=i.discount,
                line_total=i.line_total,
                needs_review=i.needs_review,
            )
            for i in parsed.items
        ],
        items_total=parsed.items_total,
    )
    return ReceiptOut(**base, failure_reason=None, draft=draft, confidence=confidence, flags=flags)


def get_receipt(
    db: Session, user: CurrentUser, receipt_id: UUID, storage: ReceiptStorage
) -> ReceiptOut:
    return to_out(db, user, _require_own(db, user, receipt_id), storage)


# ---------- upload ----------


def upload_receipt(
    db: Session,
    user: CurrentUser,
    *,
    client_id: UUID,
    data: bytes,
    ocr: OcrEngine,
    storage: ReceiptStorage,
) -> tuple[ReceiptOut, bool]:
    """Stores the image, runs OCR and returns the draft (or a failed receipt).
    Returns (receipt, created); a repeated client_id returns the existing receipt."""
    existing = _get_own(db, user, client_id)
    if existing is not None:
        return to_out(db, user, existing, storage), False

    ext, content_type = sniff_image(data)
    path = f"{user.id}/{client_id}.{ext}"
    inserted = db.scalar(
        pg_insert(Receipt)
        .values(id=client_id, user_id=user.id, image_path=path, ocr_status="processing")
        .on_conflict_do_nothing(index_elements=["id"])
        .returning(Receipt.id)
    )
    if inserted is None:
        # A concurrent retry with the same id committed first, or the id belongs to
        # someone else (invisible under RLS).
        existing = _get_own(db, user, client_id)
        if existing is not None:
            return to_out(db, user, existing, storage), False
        raise ApiError(409, "conflict", "This upload id is already in use. Scan again.")

    try:
        storage.put(path, data, content_type)
    except StorageUnavailable as exc:
        raise ApiError(
            503, "service-unavailable", "We couldn't save the photo. Please try again."
        ) from exc

    try:
        try:
            result = ocr.read(data)
        except OcrUnavailable as exc:
            raise ApiError(
                503,
                "service-unavailable",
                "Receipt reading is unavailable right now. Please try again.",
                headers={"Retry-After": "5"},
            ) from exc

        text = result.text.strip()
        parsed = _parse(text)
        row = _require_own(db, user, client_id)
        row.ocr_raw_text = (f"{SIMULATED_MARKER}\n{text}" if result.simulated else text) or None

        ocr_confidence = result.confidence if result.confidence is not None else 0.0
        unreadable = (
            len(text) < MIN_TEXT_CHARS
            or ocr_confidence < settings.ocr_min_confidence
            or not parsed.has_money
        )
        if unreadable:
            row.ocr_status = "failed"
        else:
            row.ocr_status = "draft"
            row.confidence_store = _confidence(parsed.confidence_store * ocr_confidence)
            row.confidence_items = _confidence(parsed.confidence_items * ocr_confidence)
            row.confidence_total = _confidence(parsed.confidence_total * ocr_confidence)
        db.flush()
        db.refresh(row)
        return to_out(db, user, row, storage), True
    except BaseException:
        # The receipt row is rolled back with the request; don't leave its image behind.
        _delete_quietly(storage, path)
        raise


def _delete_quietly(storage: ReceiptStorage, path: str) -> None:
    try:
        storage.delete(path)
    except Exception:  # noqa: BLE001 (cleanup must not hide the original error)
        logger.warning("Couldn't remove receipt image after a failed upload")


# ---------- confirm ----------


def _priced_lines(body: ReceiptConfirm) -> list[transaction_service.ReceiptLine]:
    lines: list[transaction_service.ReceiptLine] = []
    for index, item in enumerate(body.items):
        total = parser.line_total(item.quantity, item.unit_price, item.discount)
        if total < 0:
            raise invalid_field(
                f"items.{index}.discount", "The discount is more than the item's price.", "range"
            )
        lines.append(
            transaction_service.ReceiptLine(
                name=item.name,
                quantity=item.quantity,
                unit=item.unit,
                unit_price=item.unit_price,
                discount=item.discount,
                line_total=total,
            )
        )
    return lines


def _check_sum(body: ReceiptConfirm, lines: list[transaction_service.ReceiptLine]) -> None:
    """Items minus the receipt discount must equal the total within ±₱0.01 (AGENTS.md §7.1)."""
    if not lines:
        if body.discount > 0:
            raise invalid_field(
                "discount", "Add the items the discount applies to, or remove it.", "no_items"
            )
        return
    items_sum = sum((line.line_total for line in lines), Decimal("0"))
    if body.discount > items_sum:
        raise invalid_field("discount", "The discount is more than the items cost.", "range")
    net = items_sum - body.discount
    if abs(net - body.total) > parser.TOLERANCE:
        raise ApiError(
            422,
            "validation-error",
            "The items don't add up to the total.",
            errors=[
                FieldError(
                    field="total",
                    message=f"Items come to ₱{net:,.2f} but the total is ₱{body.total:,.2f}.",
                    code="items_mismatch",
                )
            ],
        )


def allocate_discount(
    lines: list[transaction_service.ReceiptLine], discount: Decimal
) -> list[transaction_service.ReceiptLine]:
    """Spreads a receipt-level discount over the items in proportion to their totals
    (largest remainder, whole centavos), so the stored items add up to what was paid."""
    if discount <= 0 or not lines:
        return lines
    base = sum((line.line_total for line in lines), Decimal("0"))
    cents = int(discount / CENT)
    shares = [
        (line.line_total * discount / base).quantize(CENT, rounding=ROUND_DOWN) for line in lines
    ]
    remainders = [
        line.line_total * discount / base - share for line, share in zip(lines, shares, strict=True)
    ]
    left = cents - int(sum(shares, Decimal("0")) / CENT)
    for index in sorted(range(len(lines)), key=lambda i: (-remainders[i], i))[:left]:
        shares[index] += CENT
    return [
        transaction_service.ReceiptLine(
            name=line.name,
            quantity=line.quantity,
            unit=line.unit,
            unit_price=line.unit_price,
            discount=line.discount + share,
            line_total=line.line_total - share,
        )
        for line, share in zip(lines, shares, strict=True)
    ]


def confirm_receipt(
    db: Session, user: CurrentUser, receipt_id: UUID, body: ReceiptConfirm
) -> ReceiptConfirmed:
    row = _require_own(db, user, receipt_id, lock=True)
    if row.ocr_status == "confirmed":
        saved = transaction_service.saved_for_receipt(db, user, row.id)
        if saved is None:
            raise ApiError(
                409, "conflict", "This receipt was saved before and its transaction was deleted."
            )
        return ReceiptConfirmed(**saved.model_dump(), already_confirmed=True)
    if row.ocr_status != "draft":
        raise ApiError(
            409,
            "conflict",
            "This receipt couldn't be read, so it can't be saved. Enter it manually.",
        )

    lines = _priced_lines(body)
    _check_sum(body, lines)
    saved = transaction_service.create_from_receipt(
        db,
        user,
        receipt_id=row.id,
        category_id=body.category_id,
        amount=body.total,
        occurred_at=body.occurred_at,
        merchant=body.merchant,
        note=body.note,
        lines=allocate_discount(lines, body.discount),
    )
    row.ocr_status = "confirmed"
    row.confirmed_at = datetime.now(UTC)
    db.flush()
    # Purchase patterns (step 5) and pantry estimates (step 7) will hook in here.
    return ReceiptConfirmed(**saved.model_dump(), already_confirmed=False)


# ---------- discard ----------


def discard_receipt(
    db: Session, user: CurrentUser, receipt_id: UUID, storage: ReceiptStorage
) -> None:
    """Deletes an unconfirmed receipt and its image (cancel / retake / leave a failed scan)."""
    row = _require_own(db, user, receipt_id, lock=True)
    if row.ocr_status == "confirmed":
        raise ApiError(409, "conflict", "A saved receipt can't be discarded.")
    try:
        storage.delete(row.image_path)
    except StorageUnavailable as exc:
        raise ApiError(
            503, "service-unavailable", "We couldn't remove the photo. Please try again."
        ) from exc
    db.delete(row)
    db.flush()
