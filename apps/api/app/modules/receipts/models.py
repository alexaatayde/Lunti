"""Receipts module table (AGENTS.md §7.1). The image itself lives in Supabase Storage."""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, DateTime, Index, Numeric, Text, text
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
        Index("ix_receipts_user_id_created_at", "user_id", text("created_at desc")),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), nullable=False
    )
    # Path inside the private "receipts" bucket: {user_id}/{uuid}.jpg
    image_path: Mapped[str] = mapped_column(Text, nullable=False)
    ocr_raw_text: Mapped[str | None] = mapped_column(Text)
    ocr_status: Mapped[str] = mapped_column(
        Text, server_default=text("'processing'"), nullable=False
    )
    confidence_store: Mapped[Decimal | None] = mapped_column(CONFIDENCE)
    confidence_items: Mapped[Decimal | None] = mapped_column(CONFIDENCE)
    confidence_total: Mapped[Decimal | None] = mapped_column(CONFIDENCE)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
