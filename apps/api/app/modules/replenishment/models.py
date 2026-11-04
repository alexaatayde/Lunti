"""Replenishment module tables: suggestions and shopping lists (AGENTS.md §7.4)."""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Numeric,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin
from app.modules.users.models import auth_user_fk


class ReplenishmentSuggestion(IdMixin, TimestampMixin, Base):
    __tablename__ = "replenishment_suggestions"
    __table_args__ = (
        CheckConstraint("status in ('pending', 'added', 'dismissed', 'modified')", name="status"),
        CheckConstraint("confidence_score between 0 and 1", name="confidence_range"),
        # At most one open suggestion per product, so the daily job can upsert.
        Index(
            "uq_replenishment_suggestions_pending",
            "user_id",
            "product_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_replenishment_suggestions_user_id_status", "user_id", "status"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), nullable=False
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    pattern_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("purchase_patterns.id", ondelete="SET NULL")
    )
    predicted_date: Mapped[date] = mapped_column(Date, nullable=False)
    confidence_score: Mapped[Decimal] = mapped_column(Numeric(4, 3), nullable=False)
    status: Mapped[str] = mapped_column(Text, server_default=text("'pending'"), nullable=False)


class ShoppingList(IdMixin, TimestampMixin, Base):
    __tablename__ = "shopping_lists"
    __table_args__ = (
        CheckConstraint("char_length(btrim(name)) between 1 and 60", name="name_length"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(Text, server_default=text("'Grocery list'"), nullable=False)


class ShoppingListItem(IdMixin, TimestampMixin, Base):
    __tablename__ = "shopping_list_items"
    __table_args__ = (
        CheckConstraint("source in ('manual', 'suggested', 'recipe')", name="source"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("est_price is null or est_price >= 0", name="est_price_non_negative"),
        CheckConstraint("char_length(btrim(name)) between 1 and 120", name="name_length"),
    )

    shopping_list_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("shopping_lists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(
        Numeric(10, 3), server_default=text("1"), nullable=False
    )
    unit: Mapped[str | None] = mapped_column(Text)
    est_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    is_purchased: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false"), nullable=False
    )
    source: Mapped[str] = mapped_column(Text, server_default=text("'manual'"), nullable=False)
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL")
    )
    recipe_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("recipes.id", ondelete="SET NULL")
    )
