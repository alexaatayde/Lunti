"""Idempotency keys for financial writes (Phase 8B).

The app sends `Idempotency-Key: <one id per intended expense>` and reuses it for every attempt
(a retry after a timeout, a second tap). The first request to claim a key records the expense;
later ones with the same key and the same data get that transaction back. Rules:

- Keys are per user: the same key from two users never collides or leaks (unique index on
  (user_id, scope, key), RLS on the table).
- Same key, different data → 422 `idempotency-key-reused`; nothing is written.
- Concurrent requests with one key: the unique index makes the second INSERT wait until the
  first commits (then it replays) or rolls back (then it claims the key itself). No duplicate,
  no error.
- A failed request leaves no key behind (it is rolled back with the request), so it can be
  retried with the same key.
- The key is linked to its transaction; deleting that transaction unlinks it, and a late retry
  gets 409 instead of quietly re-creating the deleted expense.
"""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.core.errors import ApiError
from app.modules.expenses.models import IdempotencyKey
from app.modules.expenses.schemas import TransactionCreate

CREATE_TRANSACTION = "transactions.create"
KEY_PATTERN = r"^[A-Za-z0-9_-]{8,128}$"


@dataclass(frozen=True)
class Claim:
    key_id: UUID | None  # set when this request owns the key and must link its result
    replay_transaction_id: UUID | None  # set when an earlier request already succeeded


def request_hash(data: TransactionCreate) -> str:
    """SHA-256 of the request after validation, so "12.5" and "12.50", or the same moment in
    two time zones, count as the same request."""
    canonical = {
        "amount": str(data.amount.quantize(Decimal("0.01"))),
        "category_id": str(data.category_id),
        "occurred_at": data.occurred_at.astimezone(UTC).isoformat(timespec="microseconds"),
        "merchant": data.merchant,
        "note": data.note,
    }
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def claim(db: Session, user: CurrentUser, scope: str, key: str, data: TransactionCreate) -> Claim:
    digest = request_hash(data)
    key_id = db.scalar(
        pg_insert(IdempotencyKey)
        .values(user_id=user.id, scope=scope, key=key, request_hash=digest)
        .on_conflict_do_nothing(index_elements=["user_id", "scope", "key"])
        .returning(IdempotencyKey.id)
    )
    if key_id is not None:
        return Claim(key_id=key_id, replay_transaction_id=None)

    # Another request with this key committed first (we waited for it if it was in flight).
    existing = db.scalar(
        select(IdempotencyKey).where(
            IdempotencyKey.user_id == user.id,
            IdempotencyKey.scope == scope,
            IdempotencyKey.key == key,
        )
    )
    if existing is None:  # pragma: no cover (the conflicting row is the caller's own)
        raise ApiError(409, "conflict", "Please try again.")
    if existing.request_hash != digest:
        raise ApiError(
            422,
            "idempotency-key-reused",
            "This expense was already saved with different details. "
            "Check your transactions before adding it again.",
        )
    if existing.transaction_id is None:
        raise ApiError(
            409,
            "conflict",
            "This expense was saved before and has since been deleted.",
        )
    return Claim(key_id=None, replay_transaction_id=existing.transaction_id)


def complete(db: Session, claimed: Claim, transaction_id: UUID) -> None:
    """Links the claimed key to the transaction this request recorded (same DB transaction)."""
    if claimed.key_id is None:
        return
    db.execute(
        update(IdempotencyKey)
        .where(IdempotencyKey.id == claimed.key_id)
        .values(transaction_id=transaction_id)
    )
