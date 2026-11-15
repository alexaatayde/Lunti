"""Receipts module table (AGENTS.md §7.1). The image itself lives in Supabase Storage."""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, Index, Integer, Numeric, Text, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin
from app.modules.users.models import auth_user_fk

CONFIDENCE = Numeric(4, 3)


class Receipt(IdMixin, TimestampMixin, Base):
    __tablename__ = "receipts"
    __table_args__ = (
        CheckConstraint(
            "ocr_status in ('processing', 'draft', 'failed', 'confirmed')", name="ocr_status"
        ),
        CheckConstraint(
            "(ocr_status = 'confirmed') = (confirmed_at is not null)", name="confirmed_at"
        ),
        CheckConstraint(
            "confidence_store between 0 and 1 and confidence_items between 0 and 1"
            " and confidence_total between 0 and 1",
            name="confidence_range",
        ),
        CheckConstraint(
            "(ocr_attempt_id is null) = (ocr_lease_expires_at is null)", name="ocr_lease"
        ),
        CheckConstraint(
            "ocr_attempt_id is null or ocr_status = 'processing'", name="ocr_lease_status"
        ),
        CheckConstraint(
            "ocr_text_purged_at is null or (ocr_status = 'confirmed' and ocr_raw_text is null)",
            name="ocr_text_purged",
        ),
        Index("ix_receipts_user_id_created_at", "user_id", text("created_at desc")),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), nullable=False
    )
    # Path inside the private "receipts" bucket: {user_id}/{uuid}.jpg
    image_path: Mapped[str] = mapped_column(Text, nullable=False)
    # Recognised text, with personal and payment identifiers masked (redaction.py) before it
    # is stored. Never returned by the API or logged. The draft is re-parsed from it; once a
    # receipt is confirmed the transaction and its items hold the structured data, and the
    # text may be removed under RECEIPT_RAW_TEXT_RETENTION_DAYS (ocr_text_purged_at).
    ocr_raw_text: Mapped[str | None] = mapped_column(Text)
    ocr_status: Mapped[str] = mapped_column(
        Text, server_default=text("'processing'"), nullable=False
    )
    confidence_store: Mapped[Decimal | None] = mapped_column(CONFIDENCE)
    confidence_items: Mapped[Decimal | None] = mapped_column(CONFIDENCE)
    confidence_total: Mapped[Decimal | None] = mapped_column(CONFIDENCE)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The upload attempt currently reading a `processing` receipt, and until when (a lease
    # that a retry may take over after a crash). Both NULL otherwise.
    ocr_attempt_id: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    ocr_lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ocr_text_purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OcrUsageDaily(IdMixin, TimestampMixin, Base):
    """Daily OCR counters (quota.py): one `user_scans` row per user and day, one app-wide
    `external_ocr` row per day. The app role has no access; only the lunti_private
    functions in migration 0006 change it."""

    __tablename__ = "ocr_usage_daily"
    __table_args__ = (
        CheckConstraint("counter in ('user_scans', 'external_ocr')", name="counter"),
        CheckConstraint("(counter = 'user_scans') = (user_id is not null)", name="owner"),
        CheckConstraint(
            "used >= 0 and succeeded >= 0 and failed >= 0 and succeeded + failed <= used",
            name="counts",
        ),
        Index(
            "uq_ocr_usage_daily_usage_date_counter",
            "usage_date",
            "counter",
            unique=True,
            postgresql_where=text("user_id is null"),
        ),
        Index(
            "uq_ocr_usage_daily_usage_date_counter_user_id",
            "usage_date",
            "counter",
            "user_id",
            unique=True,
            postgresql_where=text("user_id is not null"),
        ),
    )

    usage_date: Mapped[date] = mapped_column(Date, nullable=False)
    counter: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), index=True
    )
    used: Mapped[int] = mapped_column(Integer, server_default=text("0"), nullable=False)
    succeeded: Mapped[int] = mapped_column(Integer, server_default=text("0"), nullable=False)
    failed: Mapped[int] = mapped_column(Integer, server_default=text("0"), nullable=False)
