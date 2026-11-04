"""Users module tables: profiles, user_preferences, feedback (AGENTS.md §6)."""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Table,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin

# Supabase Auth owns auth.users; declared here only so foreign keys can point at it.
# Migrations never create or alter it (see alembic/env.py include_object).
auth_users = Table(
    "users",
    Base.metadata,
    Column("id", PG_UUID(as_uuid=True), primary_key=True),
    schema="auth",
)


def auth_user_fk() -> ForeignKey:
    return ForeignKey("auth.users.id", ondelete="CASCADE")


class Profile(TimestampMixin, Base):
    """One row per Supabase user, created by the on_auth_user_created trigger."""

    __tablename__ = "profiles"
    __table_args__ = (
        CheckConstraint("role in ('user', 'admin')", name="role"),
        CheckConstraint("currency = 'PHP'", name="currency"),
        CheckConstraint("char_length(full_name) <= 100", name="full_name_length"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), primary_key=True
    )
    full_name: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, server_default=text("'user'"), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), server_default=text("'PHP'"), nullable=False)
    # RA 10173 consent records (sign-up screen, SRS 3.5.4).
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    data_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserPreferences(TimestampMixin, Base):
    __tablename__ = "user_preferences"
    __table_args__ = (
        CheckConstraint("budget_alert_pct between 50 and 100", name="budget_alert_pct"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), primary_key=True
    )
    notify_budget: Mapped[bool] = mapped_column(
        Boolean, server_default=text("true"), nullable=False
    )
    notify_replenishment: Mapped[bool] = mapped_column(
        Boolean, server_default=text("true"), nullable=False
    )
    notify_shopping: Mapped[bool] = mapped_column(
        Boolean, server_default=text("true"), nullable=False
    )
    notify_meals: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), nullable=False)
    budget_alert_pct: Mapped[int] = mapped_column(
        SmallInteger, server_default=text("90"), nullable=False
    )


class Feedback(IdMixin, TimestampMixin, Base):
    """User reactions to suggestions, insights and recipes (SRS 3.1.11)."""

    __tablename__ = "feedback"
    __table_args__ = (
        CheckConstraint(
            "target_type in ('replenishment_suggestion', 'insight', 'recipe', "
            "'shopping_list_item')",
            name="target_type",
        ),
        CheckConstraint(
            "action in ('add_to_list', 'still_have', 'bought_elsewhere', 'dont_remind', "
            "'dismiss', 'modify')",
            name="action",
        ),
        Index("ix_feedback_user_id_target", "user_id", "target_type", "target_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), nullable=False
    )
    target_type: Mapped[str] = mapped_column(Text, nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
