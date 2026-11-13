"""Products: one row per distinct item a user buys, matched by normalized name (AGENTS.md §7.3).

Normalization (proposed): Unicode NFKC, lower case, every run of characters other than
letters and digits becomes one space, trimmed. "RICE  5KG" and "Rice 5kg" are one product;
"Rice 5kg" and "Rice 2kg" stay separate (size is part of the product).

Known limitation (approved for the MVP): matching is exact after normalization. Variants and
inconsistent receipt naming ("Eggs (12)" vs "Eggs 1 tray", "BB 33G" vs "Bear Brand 33g",
abbreviations, misreads) become separate products, so their purchases are split and their
patterns look sparser than they are. There is no fuzzy matching or user merge yet.
"""

import re
import unicodedata
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.modules.analytics.models import Product

_SEPARATORS = re.compile(r"[\W_]+", re.UNICODE)


def normalize_name(name: str) -> str:
    return _SEPARATORS.sub(" ", unicodedata.normalize("NFKC", name).lower()).strip()


def match_or_create(
    db: Session, user: CurrentUser, items: list[tuple[str, str | None]]
) -> list[UUID | None]:
    """Product id for each (name, unit), creating missing products. Names that normalize to
    nothing (only punctuation) get None. Concurrent inserts are safe (unique constraint)."""
    keys = [normalize_name(name) for name, _ in items]
    new: dict[str, tuple[str, str | None]] = {}
    for key, (name, unit) in zip(keys, items, strict=True):
        if key and key not in new:
            new[key] = (name.strip()[:120], unit)
    if new:
        db.execute(
            pg_insert(Product)
            .values(
                [
                    {"user_id": user.id, "name": name, "normalized_name": key, "default_unit": unit}
                    for key, (name, unit) in new.items()
                ]
            )
            .on_conflict_do_nothing(index_elements=["user_id", "normalized_name"])
        )
    ids = dict(
        db.execute(
            select(Product.normalized_name, Product.id).where(
                Product.user_id == user.id, Product.normalized_name.in_(list(new))
            )
        ).all()
    )
    return [ids.get(key) if key else None for key in keys]


def refs(db: Session, user: CurrentUser, ids: set[UUID]) -> dict[UUID, tuple[str, str | None]]:
    """(name, default unit) per product id."""
    if not ids:
        return {}
    rows = db.execute(
        select(Product.id, Product.name, Product.default_unit).where(
            Product.user_id == user.id, Product.id.in_(ids)
        )
    )
    return {i: (name, unit) for i, name, unit in rows}
