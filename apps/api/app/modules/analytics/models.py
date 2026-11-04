"""Analytics module tables: products and purchase_patterns (AGENTS.md §7.3)."""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin
from app.modules.users.models import auth_user_fk


class Product(IdMixin, TimestampMixin, Base):
    """A distinct item a user buys, matched across receipts by normalized_name."""

    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("user_id", "normalized_name"),
        CheckConstraint("char_length(btrim(name)) between 1 and 120", name="name_length"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_name: Mapped[str] = mapped_column(Text, nullable=False)
    is_food: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), nullable=False)
    default_category_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL")
    )
    default_unit: Mapped[str | None] = mapped_column(Text)


class PurchasePattern(IdMixin, TimestampMixin, Base):
    __tablename__ = "purchase_patterns"
    __table_args__ = (
        UniqueConstraint("user_id", "product_id"),
        CheckConstraint("purchase_count >= 0", name="purchase_count"),
        CheckConstraint("confidence_score between 0 and 1", name="confidence_range"),
        CheckConstraint("data_tier in ('sufficient', 'limited', 'insufficient')", name="data_tier"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), nullable=False
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    avg_interval_days: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    interval_stddev_days: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    purchase_count: Mapped[int] = mapped_column(Integer, server_default=text("0"), nullable=False)
    last_purchased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confidence_score: Mapped[Decimal] = mapped_column(
        Numeric(4, 3), server_default=text("0"), nullable=False
    )
    data_tier: Mapped[str] = mapped_column(
        Text, server_default=text("'insufficient'"), nullable=False
    )
