"""Receipt pipeline: upload → OCR → draft → user confirms → transaction (AGENTS.md §7.1).

Rules this module enforces:
- A draft is never a transaction. Only `confirm` writes financial records, in one database
  transaction with the line items, the receipt status and the budget recalculation.
- Photos are sanitised before anything else (images.sanitize): only the re-encoded,
  metadata-free JPEG is stored or sent to OCR.
- OCR runs outside any database transaction (see "upload" below): the receipt is committed
  as `processing` with a lease first, and the result is written only by the attempt that
  still holds it. Each OCR call first takes one attempt from the daily quota (quota.py).
- Recognised text is redacted (redaction.py) before it is parsed or stored; it is never
  returned by the API or written to logs.
- Uploads are idempotent: the app sends its own id for each image (`client_id`, used as the
  receipt id), so a retried upload returns the same receipt instead of a second one. A retry
  must carry the same photo: a different photo under a used id is refused (409), and an
  accepted photo is never replaced. See `upload_receipt` for interrupted uploads.
- Confirmations are idempotent: the receipt row is locked, a confirmed receipt returns the
  transaction it already produced, and `transactions.receipt_id` is unique.
- Every query filters by the caller's user_id; RLS applies too. Another user's receipt is
  "not found".

The draft is not stored as columns: it is rebuilt from `ocr_raw_text` by the deterministic
parser, with the per-field confidences stored at upload time.
"""

import dataclasses
import hashlib
import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import ROUND_DOWN, Decimal
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.db import scope_session_to_user
from app.core.errors import ApiError, FieldError, invalid_field, not_found
from app.modules.analytics import products
from app.modules.expenses import periods, transaction_service
from app.modules.expenses import service as categories_service
from app.modules.expenses.schemas import CategoryRef
from app.modules.receipts import cleanup, images, parser, quota, redaction
from app.modules.receipts.models import Receipt
from app.modules.receipts.ocr import (
    FIXTURE,
    GOOGLE_VISION,
    OcrEngine,
    OcrUnavailable,
    is_external,
)
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
from app.modules.receipts.storage import ObjectExists, ReceiptStorage, StorageUnavailable

logger = logging.getLogger(__name__)

# First line of `ocr_raw_text` for development fixture results, so a simulated draft stays
# labelled as simulated when it is read back later.
SIMULATED_MARKER = "[lunti:simulated-ocr]"
MIN_TEXT_CHARS = 10
LOW_CONFIDENCE = 0.8
CENT = Decimal("0.01")

# ---------- helpers ----------


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
#
# The upload never holds a database transaction (or a pooled connection) while it waits for
# storage or OCR. It works in short transactions around the external calls:
#
#   1. claim     insert the receipt as `processing` with a lease (ocr_attempt_id + expiry),
#                commit. A retry of the same client_id finds the row: finished → return it;
#                leased by a live attempt → wait for it; lease expired (crashed process,
#                timeout) → take it over.
#   2. photo     store the sanitised photo (no transaction).
#   3. reserve   renew the lease and take one OCR attempt from today's quota, commit.
#   4. OCR       no transaction, no connection.
#   5. finish    write the result only if this attempt still holds the lease
#                (`where ocr_attempt_id = :attempt`). A receipt discarded meanwhile stays
#                deleted, and its photo is removed again; a receipt taken over by another
#                attempt is left to that attempt.
#
# A failure before the result is written deletes the row (and the photo, except after a
# storage failure where the retry reuses it), so a retry starts cleanly, as before.

UPLOAD_WAIT_DETAIL = "This receipt is still being read. Please try again in a moment."
MAX_LOST_CLAIMS = 2  # OCR runs per request at most, even if leases keep being taken over


@dataclass(frozen=True)
class _Claim:
    kind: Literal["new", "takeover", "busy", "done", "foreign"]
    image_path: str = ""
    attempt_id: UUID | None = None


@contextmanager
def _user_tx(factory: sessionmaker[Session], user: CurrentUser) -> Iterator[Session]:
    """One short transaction as the app role, scoped to the caller (RLS), like a request."""
    with factory() as db, db.begin():
        scope_session_to_user(db, user.id)
        yield db


def _lease_end():  # noqa: ANN202 - SQL expression
    return func.now() + timedelta(seconds=settings.ocr_lease_seconds)


def _claim(factory: sessionmaker[Session], user: CurrentUser, client_id: UUID, path: str) -> _Claim:
    attempt = uuid4()
    with _user_tx(factory, user) as db:
        row = _get_own(db, user, client_id)
        if row is None:
            # The path lock makes the orphan cleanup either finish with this path first or
            # see the committed row afterwards (cleanup.delete_orphan_images).
            cleanup.lock_image_path(db, path)
            inserted = db.scalar(
                pg_insert(Receipt)
                .values(
                    id=client_id,
                    user_id=user.id,
                    image_path=path,
                    ocr_status="processing",
                    ocr_attempt_id=attempt,
                    ocr_lease_expires_at=_lease_end(),
                )
                .on_conflict_do_nothing(index_elements=["id"])
                .returning(Receipt.id)
            )
            if inserted is not None:
                return _Claim("new", path, attempt)
            # A concurrent request with this id committed first, or the id belongs to
            # someone else (invisible under RLS).
            row = _get_own(db, user, client_id)
            if row is None:
                return _Claim("foreign")
        if row.ocr_status != "processing":
            return _Claim("done", row.image_path)
        cleanup.lock_image_path(db, row.image_path)
        taken = db.scalar(
            update(Receipt)
            .where(
                Receipt.id == client_id,
                Receipt.user_id == user.id,
                Receipt.ocr_status == "processing",
                or_(
                    Receipt.ocr_lease_expires_at.is_(None),
                    Receipt.ocr_lease_expires_at <= func.now(),
                ),
            )
            .values(ocr_attempt_id=attempt, ocr_lease_expires_at=_lease_end())
            .returning(Receipt.id)
            .execution_options(synchronize_session=False)
        )
        if taken is None:
            return _Claim("busy", row.image_path)
        logger.info("Taking over a receipt whose earlier upload never finished")
        return _Claim("takeover", row.image_path, attempt)


def _held(attempt: UUID):  # noqa: ANN202 - SQL expression
    return and_(
        Receipt.ocr_status == "processing",
        Receipt.ocr_attempt_id == attempt,
        Receipt.ocr_lease_expires_at > func.now(),
    )


def _abandon(
    factory: sessionmaker[Session],
    user: CurrentUser,
    client_id: UUID,
    attempt: UUID,
    storage: ReceiptStorage,
    *,
    delete_photo: bool,
    reservation: quota.Reservation | None = None,
) -> None:
    """Undo this attempt's receipt (only while it still owns it), so a retry starts cleanly.
    Never raises: the caller is already reporting the original error."""
    try:
        with _user_tx(factory, user) as db:
            if reservation is not None:
                quota.record_outcome(db, reservation, "failed")
            path = db.scalar(
                delete(Receipt)
                .where(
                    Receipt.id == client_id,
                    Receipt.user_id == user.id,
                    Receipt.ocr_status == "processing",
                    Receipt.ocr_attempt_id == attempt,
                )
                .returning(Receipt.image_path)
                .execution_options(synchronize_session=False)
            )
    except Exception:  # noqa: BLE001 - the lease expires; cleanup removes it later
        logger.warning("Couldn't undo an unfinished receipt; its lease will expire")
        return
    if path is not None and delete_photo:
        _delete_quietly(storage, path)


def _release(
    factory: sessionmaker[Session], user: CurrentUser, client_id: UUID, attempt: UUID
) -> None:
    """Give up the lease but keep the receipt (another upload's photo is stored for it)."""
    try:
        with _user_tx(factory, user) as db:
            db.execute(
                update(Receipt)
                .where(Receipt.id == client_id, Receipt.user_id == user.id, _held(attempt))
                .values(ocr_attempt_id=None, ocr_lease_expires_at=None)
                .execution_options(synchronize_session=False)
            )
    except Exception:  # noqa: BLE001 - the lease expires on its own
        logger.warning("Couldn't release a receipt lease; it will expire")


def _read_out(
    factory: sessionmaker[Session], user: CurrentUser, client_id: UUID, storage: ReceiptStorage
) -> ReceiptOut | None:
    with _user_tx(factory, user) as db:
        row = _get_own(db, user, client_id)
        return None if row is None else to_out(db, user, row, storage)


def upload_receipt(
    factory: sessionmaker[Session],
    user: CurrentUser,
    *,
    client_id: UUID,
    data: bytes,
    ocr: OcrEngine,
    storage: ReceiptStorage,
) -> tuple[ReceiptOut, bool]:
    """Sanitises and stores the photo, runs OCR and returns the draft (or a failed receipt).
    Returns (receipt, created). See the section comment above for the transaction steps.

    Retries (the app resends the same `client_id` after a timeout or a lost response):
    - The id has a finished receipt: the stored photo is compared with this one. Identical
      (same sanitised bytes, or the same original bytes for photos stored before
      sanitising) → that receipt is returned, nothing is written. Different → 409; the
      accepted photo and receipt are never touched.
    - The id is being read by another request: this one waits up to OCR_WAIT_SECONDS for
      that result (then the same comparison), or answers 503 + Retry-After. Only one
      request per id ever calls OCR at a time, and only one receipt row can exist per id.
    - The earlier request died (lease expired): this one takes over, reusing the stored
      photo if it is identical (409 if it is a different photo).
    - Only the request holding the claim writes the photo. If an object is already at the
      path it is left over from an attempt that was undone: reused if identical, otherwise
      replaced. A photo a finished receipt points to is never replaced.
    """
    clean = images.sanitize(data)  # 422 before anything is read or written
    path = f"{user.id}/{client_id}.{clean.ext}"
    deadline = time.monotonic() + settings.ocr_wait_seconds
    lost = 0
    while True:
        claim = _claim(factory, user, client_id, path)
        if claim.kind == "foreign":
            raise ApiError(409, "conflict", "This upload id is already in use. Scan again.")
        if claim.kind == "done":
            _require_same_photo(storage, claim.image_path, clean, data)
            existing = _read_out(factory, user, client_id, storage)
            if existing is not None:
                return existing, False
            continue  # discarded in between: the id is free again
        if claim.kind == "busy":
            if time.monotonic() >= deadline:
                raise ApiError(
                    503, "service-unavailable", UPLOAD_WAIT_DETAIL, headers={"Retry-After": "5"}
                )
            time.sleep(settings.ocr_poll_seconds)
            continue
        assert claim.attempt_id is not None
        result = _read_with_claim(factory, user, client_id, claim, clean, data, ocr, storage)
        if result is not None:
            return result, True
        # This attempt lost its lease to a retry (it ran past OCR_LEASE_SECONDS): wait for
        # that attempt's result like any other duplicate. Bounded, so a request never keeps
        # re-running OCR; the app's own retry picks up the finished receipt.
        lost += 1
        if lost >= MAX_LOST_CLAIMS:
            raise ApiError(
                503, "service-unavailable", UPLOAD_WAIT_DETAIL, headers={"Retry-After": "5"}
            )


def _read_with_claim(
    factory: sessionmaker[Session],
    user: CurrentUser,
    client_id: UUID,
    claim: _Claim,
    clean: images.CleanImage,
    original: bytes,
    ocr: OcrEngine,
    storage: ReceiptStorage,
) -> ReceiptOut | None:
    attempt = claim.attempt_id
    assert attempt is not None
    path = claim.image_path

    # 2. photo (no transaction)
    try:
        if claim.kind == "takeover":
            _adopt_photo(storage, path, clean, original)
        else:
            _store_photo(storage, path, clean)
    except StorageUnavailable as exc:
        # Keep the photo if it got stored: the retry reuses it, or cleanup removes it.
        _abandon(factory, user, client_id, attempt, storage, delete_photo=False)
        raise ApiError(
            503, "service-unavailable", "We couldn't save the photo. Please try again."
        ) from exc
    except ApiError:  # 409: an earlier upload stored a different photo for this id
        _release(factory, user, client_id, attempt)
        raise
    except BaseException:
        _abandon(factory, user, client_id, attempt, storage, delete_photo=False)
        raise

    # 3. renew the lease and reserve today's quota (one short transaction)
    external = is_external(ocr)
    try:
        with _user_tx(factory, user) as db:
            renewed = db.scalar(
                update(Receipt)
                .where(Receipt.id == client_id, Receipt.user_id == user.id, _held(attempt))
                .values(ocr_lease_expires_at=_lease_end())
                .returning(Receipt.id)
                .execution_options(synchronize_session=False)
            )
            reservation = quota.reserve(db, external=external) if renewed else None
    except BaseException:
        _abandon(factory, user, client_id, attempt, storage, delete_photo=True)
        raise
    if reservation is None:
        return _lost_claim(factory, user, client_id, path, storage)

    # 4. OCR: no transaction and no pooled connection held while it runs
    started = time.monotonic()
    try:
        result = ocr.read(clean.data)  # the sanitised photo: no original metadata
    except OcrUnavailable as exc:
        _log_ocr(ocr, "unavailable", started)
        _abandon(
            factory, user, client_id, attempt, storage, delete_photo=True, reservation=reservation
        )
        raise ApiError(
            503,
            "service-unavailable",
            "Receipt reading is unavailable right now. Please try again.",
            headers={"Retry-After": "5"},
        ) from exc
    except BaseException:
        _log_ocr(ocr, "error", started)
        _abandon(
            factory, user, client_id, attempt, storage, delete_photo=True, reservation=reservation
        )
        raise

    # 5. finish: only while this attempt still owns the receipt
    text = redaction.redact(result.text).strip()
    parsed = _parse(text)
    ocr_confidence = result.confidence if result.confidence is not None else 0.0
    unreadable = (
        len(text) < MIN_TEXT_CHARS
        or ocr_confidence < settings.ocr_min_confidence
        or not parsed.has_money
    )
    values: dict[str, object] = {
        "ocr_raw_text": (f"{SIMULATED_MARKER}\n{text}" if result.simulated else text) or None,
        "ocr_status": "failed" if unreadable else "draft",
        "ocr_attempt_id": None,
        "ocr_lease_expires_at": None,
    }
    if not unreadable:
        values |= {
            "confidence_store": _confidence(parsed.confidence_store * ocr_confidence),
            "confidence_items": _confidence(parsed.confidence_items * ocr_confidence),
            "confidence_total": _confidence(parsed.confidence_total * ocr_confidence),
        }
    _log_ocr(ocr, str(values["ocr_status"]), started, chars=len(text))
    with _user_tx(factory, user) as db:
        quota.record_outcome(db, reservation, "succeeded")
        # Not `_held`: the lease may have run out while OCR worked; what matters is that no
        # other attempt has taken over (that would have changed ocr_attempt_id).
        finished = db.scalar(
            update(Receipt)
            .where(
                Receipt.id == client_id,
                Receipt.user_id == user.id,
                Receipt.ocr_status == "processing",
                Receipt.ocr_attempt_id == attempt,
            )
            .values(**values)
            .returning(Receipt.id)
            .execution_options(synchronize_session=False)
        )
        if finished is not None:
            return to_out(db, user, _require_own(db, user, client_id), storage)
    return _lost_claim(factory, user, client_id, path, storage)


def _lost_claim(
    factory: sessionmaker[Session],
    user: CurrentUser,
    client_id: UUID,
    path: str,
    storage: ReceiptStorage,
) -> None:
    """The attempt no longer owns its receipt. Discarded meanwhile → it stays deleted (and
    its photo is removed again, in case this attempt stored it after the discard). Taken
    over by a retry → None: the caller waits for that attempt's result."""
    with _user_tx(factory, user) as db:
        exists = _get_own(db, user, client_id) is not None
    if exists:
        return None
    _delete_quietly(storage, path)
    raise ApiError(409, "conflict", "This scan was cancelled before it finished reading.")


def _log_ocr(engine: OcrEngine, outcome: str, started: float, *, chars: int = 0) -> None:
    """Engine, outcome, duration and text length only: never the text, image or ids."""
    logger.info(
        "Receipt OCR %s: engine=%s duration_ms=%d chars=%d",
        outcome,
        engine.name,
        int((time.monotonic() - started) * 1000),
        chars,
    )


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _require_same_photo(
    storage: ReceiptStorage, stored_path: str, clean: images.CleanImage, original: bytes
) -> None:
    """409 unless this upload carries the photo the existing receipt was made from."""
    try:
        stored = storage.get(stored_path)
    except StorageUnavailable as exc:
        raise ApiError(
            503, "service-unavailable", "We couldn't check this photo. Please try again."
        ) from exc
    if stored is None:
        # The receipt stands on its own (OCR text, status); there is nothing to compare.
        logger.warning("Receipt photo missing in storage; returning the receipt as it is")
        return
    if _sha256(stored) in (clean.sha256, _sha256(original)):
        return
    raise ApiError(
        409,
        "conflict",
        "This upload id was already used for a different photo. Scan again.",
    )


def _store_photo(storage: ReceiptStorage, path: str, clean: images.CleanImage) -> None:
    """Writes the photo without ever overwriting blindly. Called only by the request that
    holds the new receipt row and the path lock (see upload_receipt)."""
    try:
        storage.put(path, clean.data, clean.content_type)
        return
    except ObjectExists:
        pass
    leftover = storage.get(path)
    if leftover is not None and _sha256(leftover) == clean.sha256:
        logger.info("Reusing the photo stored by an earlier, interrupted upload")
        return
    # A different (or vanished) photo from an attempt that never committed: replace it.
    logger.info("Replacing a photo left over from an upload that never committed")
    storage.delete(path)
    try:
        storage.put(path, clean.data, clean.content_type)
    except ObjectExists as exc:  # someone else wrote it in between: never overwrite
        raise StorageUnavailable("photo appeared again while replacing it") from exc


def _adopt_photo(
    storage: ReceiptStorage, path: str, clean: images.CleanImage, original: bytes
) -> None:
    """Takeover of an unfinished receipt: reuse the photo its earlier upload stored if it is
    this photo (409 if it is a different one); store this one if none was stored."""
    try:
        stored = storage.get(path)
    except StorageUnavailable:
        raise
    if stored is None:
        _store_photo(storage, path, clean)
        return
    if _sha256(stored) in (clean.sha256, _sha256(original)):
        return
    raise ApiError(
        409,
        "conflict",
        "This upload id was already used for a different photo. Scan again.",
    )


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
            product_id=line.product_id,
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
    if row.ocr_status == "processing":
        raise ApiError(409, "conflict", UPLOAD_WAIT_DETAIL)
    if row.ocr_status != "draft":
        raise ApiError(
            409,
            "conflict",
            "This receipt couldn't be read, so it can't be saved. Enter it manually.",
        )

    lines = _priced_lines(body)
    _check_sum(body, lines)
    product_ids = products.match_or_create(db, user, [(line.name, line.unit) for line in lines])
    lines = [
        dataclasses.replace(line, product_id=product_id)
        for line, product_id in zip(lines, product_ids, strict=True)
    ]
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
    transaction_service.refresh_purchases(db, user, {p for p in product_ids if p is not None})
    # Pantry estimates (step 7) will hook in here.
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
