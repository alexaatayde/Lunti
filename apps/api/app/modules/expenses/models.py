"""Expenses module tables: categories, transactions, transaction_line_items, budgets."""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin
from app.modules.users.models import auth_user_fk

MONEY = Numeric(12, 2)
QUANTITY = Numeric(10, 3)


class Category(IdMixin, TimestampMixin, Base):
    """Defaults have user_id NULL and is_default true; users can add their own."""

    __tablename__ = "categories"
    __table_args__ = (
        CheckConstraint(
            "(is_default and user_id is null) or (not is_default and user_id is not null)",
            name="owner",
        ),
        CheckConstraint("char_length(btrim(name)) between 1 and 40", name="name_length"),
        CheckConstraint("icon is null or icon ~ '^[a-z0-9-]{1,32}$'", name="icon_format"),
        # Case-insensitive unique names: per user, and among defaults.
        Index(
            "uq_categories_user_id_name",
            "user_id",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("user_id is not null"),
        ),
        Index(
            "uq_categories_default_name",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("user_id is null"),
        ),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True), auth_user_fk())
    name: Mapped[str] = mapped_column(Text, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), nullable=False)
    icon: Mapped[str | None] = mapped_column(Text)
    # Display order (defaults follow design/screens/TxnCategory.html; user categories after).
    sort_order: Mapped[int] = mapped_column(
        SmallInteger, server_default=text("100"), nullable=False
    )


class Transaction(IdMixin, TimestampMixin, Base):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="amount_non_negative"),
        CheckConstraint("source in ('manual', 'receipt')", name="source"),
        CheckConstraint("source = 'receipt' or receipt_id is null", name="manual_has_no_receipt"),
        CheckConstraint("merchant is null or char_length(merchant) <= 120", name="merchant_length"),
        CheckConstraint("note is null or char_length(note) <= 500", name="note_length"),
        Index("ix_transactions_user_id_occurred_at", "user_id", text("occurred_at desc")),
        Index("ix_transactions_user_id_category_id", "user_id", "category_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), nullable=False
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    merchant: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text, server_default=text("'manual'"), nullable=False)
    receipt_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("receipts.id", ondelete="SET NULL"),
        unique=True,
    )


class TransactionLineItem(IdMixin, TimestampMixin, Base):
    __tablename__ = "transaction_line_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("unit_price >= 0", name="unit_price_non_negative"),
        CheckConstraint("discount >= 0", name="discount_non_negative"),
        CheckConstraint("tax >= 0", name="tax_non_negative"),
        CheckConstraint("line_total >= 0", name="line_total_non_negative"),
        CheckConstraint("char_length(btrim(name)) between 1 and 120", name="name_length"),
    )

    transaction_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("transactions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"), index=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(QUANTITY, server_default=text("1"), nullable=False)
    unit: Mapped[str | None] = mapped_column(Text)
    unit_price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    discount: Mapped[Decimal] = mapped_column(MONEY, server_default=text("0"), nullable=False)
    tax: Mapped[Decimal] = mapped_column(MONEY, server_default=text("0"), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)


class Budget(IdMixin, TimestampMixin, Base):
    __tablename__ = "budgets"
    __table_args__ = (
        CheckConstraint(
            "period_type in ('daily', 'weekly', 'monthly', 'custom')", name="period_type"
        ),
        CheckConstraint("limit_amount > 0", name="limit_positive"),
        CheckConstraint("end_date is null or end_date >= start_date", name="date_order"),
        CheckConstraint(
            "period_type <> 'custom' or end_date is not null", name="custom_has_end_date"
        ),
        CheckConstraint(
            "last_alert_level in ('none', 'near', 'exceeded')", name="last_alert_level"
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), nullable=False, index=True
    )
    # NULL = overall budget across all categories.
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("categories.id", ondelete="RESTRICT"), index=True
    )
    period_type: Mapped[str] = mapped_column(Text, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    limit_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    alerts_enabled: Mapped[bool] = mapped_column(
        Boolean, server_default=text("true"), nullable=False
    )
    last_alert_level: Mapped[str] = mapped_column(
        Text, server_default=text("'none'"), nullable=False
    )
