"""Notifications module tables: notifications and device_tokens (AGENTS.md §3.7.5)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, Index, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin
from app.modules.users.models import auth_user_fk


class Notification(IdMixin, TimestampMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_user_id_created_at", "user_id", text("created_at desc")),
        # One notification per (user, key): repeated job runs insert each reminder once.
        Index("uq_notifications_user_id_dedupe_key", "user_id", "dedupe_key", unique=True),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), nullable=False
    )
    type: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb"), nullable=False
    )
    deep_link: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dedupe_key: Mapped[str | None] = mapped_column(Text)


class DeviceToken(IdMixin, TimestampMixin, Base):
    __tablename__ = "device_tokens"
    __table_args__ = (CheckConstraint("platform in ('android', 'ios')", name="platform"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), nullable=False, index=True
    )
    fcm_token: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    platform: Mapped[str] = mapped_column(Text, nullable=False)
