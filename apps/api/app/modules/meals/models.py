"""Meals module tables: ingredient_inventory, recipes, recipe_ingredients (AGENTS.md §7.5).
The recipe catalog is shared (no user_id) and seeded by admins.
"""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Numeric,
    SmallInteger,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin
from app.modules.users.models import auth_user_fk


class IngredientInventory(IdMixin, TimestampMixin, Base):
    """Estimated pantry; shown as an estimate until confirmed_by_user."""

    __tablename__ = "ingredient_inventory"
    __table_args__ = (
        UniqueConstraint("user_id", "product_id"),
        CheckConstraint("estimated_quantity >= 0", name="quantity_non_negative"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), auth_user_fk(), nullable=False
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    estimated_quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    unit: Mapped[str | None] = mapped_column(Text)
    estimated_expiry: Mapped[date | None] = mapped_column(Date)
    confirmed_by_user: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false"), nullable=False
    )


class Recipe(IdMixin, TimestampMixin, Base):
    __tablename__ = "recipes"
    __table_args__ = (
        CheckConstraint("servings > 0", name="servings_positive"),
        CheckConstraint("prep_time_minutes >= 0", name="prep_time_non_negative"),
        CheckConstraint("char_length(btrim(name)) between 1 and 120", name="name_length"),
    )

    name: Mapped[str] = mapped_column(Text, nullable=False)
    servings: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    prep_time_minutes: Mapped[int] = mapped_column(SmallInteger, nullable=False)


class RecipeIngredient(IdMixin, TimestampMixin, Base):
    __tablename__ = "recipe_ingredients"
    __table_args__ = (
        CheckConstraint("quantity_required > 0", name="quantity_positive"),
        CheckConstraint("char_length(btrim(name)) between 1 and 120", name="name_length"),
    )

    recipe_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("recipes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Matching against a user's products is done by normalized name at query time;
    # product_id stays NULL for catalog recipes (products are per user).
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    quantity_required: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    unit: Mapped[str | None] = mapped_column(Text)
