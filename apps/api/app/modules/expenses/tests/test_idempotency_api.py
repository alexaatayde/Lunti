"""Idempotent manual transaction creation (Phase 8B) against a real database.

A retried POST /transactions with the same Idempotency-Key must never record the expense twice,
whether the retry comes after a lost response, at the same moment, or after a failure.
"""

import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.modules.expenses import periods
from app.modules.expenses import transaction_service as service
from app.modules.expenses.schemas import TransactionCreate
from app.modules.notifications import service as notifications

pytestmark = pytest.mark.db

API = "/api/v1/transactions"


def now_local() -> datetime:
    return datetime.now(periods.app_tz()).replace(microsecond=0)


@pytest.fixture
def user(db_client: TestClient, make_user, auth_header):  # noqa: ANN001, ANN201
    user_id = make_user()
    headers = auth_header(user_id)
    cats = {c["name"]: c["id"] for c in db_client.get("/api/v1/categories", headers=headers).json()}
    return user_id, headers, cats


def body_for(cats: dict[str, str], **overrides) -> dict:  # noqa: ANN003
    body = {
        "amount": "95.00",
        "category_id": cats["Groceries"],
        "occurred_at": now_local().isoformat(),
        "merchant": "ZZ Test Store",
        "note": "weekly",
    }
    body.update(overrides)
    return body


def post(client: TestClient, headers: dict, body: dict, key: str | None):  # noqa: ANN201
    extra = {"Idempotency-Key": key} if key is not None else {}
    return client.post(API, headers={**headers, **extra}, json=body)


def count_transactions(admin_engine: Engine, user_id: uuid.UUID) -> int:
    with admin_engine.connect() as conn:
        return conn.execute(
            text("select count(*) from transactions where user_id = :u"), {"u": user_id}
        ).scalar_one()


def count_notifications(admin_engine: Engine, user_id: uuid.UUID) -> int:
    with admin_engine.connect() as conn:
        return conn.execute(
            text("select count(*) from notifications where user_id = :u"), {"u": user_id}
        ).scalar_one()


# ---------- repeats ----------


def test_repeat_returns_the_original_transaction_without_a_second_record(
    db_client: TestClient, user, admin_engine: Engine
) -> None:
    user_id, headers, cats = user
    key = str(uuid.uuid4())
    body = body_for(cats)

    first = post(db_client, headers, body, key)
    second = post(db_client, headers, body, key)
    third = post(db_client, headers, body, key)

    assert first.status_code == 201 and "Idempotent-Replayed" not in first.headers
    assert second.status_code == 200 and second.headers["Idempotent-Replayed"] == "true"
    assert third.status_code == 200
    assert first.json()["id"] == second.json()["id"] == third.json()["id"]
    assert second.json()["amount"] == "95.00"
    assert count_transactions(admin_engine, user_id) == 1


def test_equivalent_spellings_of_the_same_request_replay(
    db_client: TestClient, user, admin_engine: Engine
) -> None:
    """The comparison is on the validated request: 95 == "95.00", the same instant in another
    time zone, surrounding spaces in text fields."""
    user_id, headers, cats = user
    key = str(uuid.uuid4())
    when = now_local()
    first = post(db_client, headers, body_for(cats, occurred_at=when.isoformat()), key)
    again = post(
        db_client,
        headers,
        body_for(
            cats,
            amount=95,
            occurred_at=when.astimezone(UTC).isoformat(),
            merchant="  ZZ Test Store ",
        ),
        key,
    )
    assert first.status_code == 201 and again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    assert count_transactions(admin_engine, user_id) == 1


@pytest.mark.parametrize(
    "change",
    [
        {"amount": "95.01"},
        {"merchant": "Another store"},
        {"note": None},
        {"occurred_at": "2026-01-01T09:00:00+08:00"},
    ],
)
def test_same_key_with_different_data_is_rejected(
    db_client: TestClient, user, admin_engine: Engine, change: dict
) -> None:
    user_id, headers, cats = user
    key = str(uuid.uuid4())
    assert post(db_client, headers, body_for(cats), key).status_code == 201

    conflict = post(db_client, headers, body_for(cats, **change), key)

    assert conflict.status_code == 422
    assert conflict.json()["type"] == "urn:lunti:problem:idempotency-key-reused"
    assert count_transactions(admin_engine, user_id) == 1


def test_a_different_category_with_the_same_key_is_rejected(
    db_client: TestClient, user, admin_engine: Engine
) -> None:
    user_id, headers, cats = user
    key = str(uuid.uuid4())
    assert post(db_client, headers, body_for(cats), key).status_code == 201
    conflict = post(db_client, headers, body_for(cats, category_id=cats["Transport"]), key)
    assert conflict.status_code == 422
    assert count_transactions(admin_engine, user_id) == 1


def test_without_a_key_each_request_is_a_new_expense(
    db_client: TestClient, user, admin_engine: Engine
) -> None:
    """Backward compatible: the header is optional (the app always sends it)."""
    user_id, headers, cats = user
    body = body_for(cats)
    assert post(db_client, headers, body, None).status_code == 201
    assert post(db_client, headers, body, None).status_code == 201
    assert count_transactions(admin_engine, user_id) == 2


@pytest.mark.parametrize(
    "key", ["short", "x" * 129, "has space here", "semi;colon-key", "a/b/c/d/e"]
)
def test_malformed_keys_are_rejected(
    db_client: TestClient, user, admin_engine: Engine, key: str
) -> None:
    user_id, headers, cats = user
    response = db_client.post(
        API,
        headers={**headers, "Idempotency-Key": key},
        json=body_for(cats),
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "Idempotency-Key"
    assert count_transactions(admin_engine, user_id) == 0


# ---------- side effects happen once ----------


def test_budget_alert_and_notification_happen_once(
    db_client: TestClient, user, admin_engine: Engine
) -> None:
    user_id, headers, cats = user
    budget = db_client.post(
        "/api/v1/budgets",
        headers=headers,
        json={"category_id": cats["Groceries"], "period_type": "monthly", "limit_amount": "100"},
    )
    assert budget.status_code == 201, budget.text
    key = str(uuid.uuid4())
    body = body_for(cats)

    first = post(db_client, headers, body, key)
    replay = post(db_client, headers, body, key)

    assert [a["level"] for a in first.json()["budget_alerts"]] == ["near"]
    assert replay.json()["budget_alerts"] == []  # reported (and notified) the first time
    assert count_notifications(admin_engine, user_id) == 1

    status = db_client.get("/api/v1/budgets/status", headers=headers).json()
    assert [s["spent"] for s in status] == ["95.00"]
    summary = db_client.get(f"{API}/summary", headers=headers).json()
    assert summary["count"] == 1 and summary["total"] == "95.00"
    analytics = db_client.get("/api/v1/analytics/summary?period=monthly", headers=headers)
    assert analytics.status_code == 200
    assert analytics.json()["total"] == "95.00"


def test_a_key_conflict_has_no_budget_or_notification_side_effects(
    db_client: TestClient, user, admin_engine: Engine
) -> None:
    user_id, headers, cats = user
    db_client.post(
        "/api/v1/budgets",
        headers=headers,
        json={"category_id": cats["Groceries"], "period_type": "monthly", "limit_amount": "100"},
    )
    key = str(uuid.uuid4())
    assert post(db_client, headers, body_for(cats, amount="50.00"), key).status_code == 201

    def state() -> tuple:
        with admin_engine.connect() as conn:
            return conn.execute(
                text(
                    "select (select count(*) from transactions where user_id = :u),"
                    " (select sum(amount) from transactions where user_id = :u),"
                    " (select count(*) from notifications where user_id = :u),"
                    " (select string_agg(last_alert_level, ',') from budgets where user_id = :u),"
                    " (select count(*) from idempotency_keys where user_id = :u)"
                ),
                {"u": user_id},
            ).one()

    before = state()
    # Would push the budget over its limit if it were recorded.
    conflict = post(db_client, headers, body_for(cats, amount="99.00"), key)
    assert conflict.status_code == 422
    assert state() == before
    assert before[3] == "none" and before[2] == 0


def test_replay_reflects_later_edits_of_the_same_transaction(db_client: TestClient, user) -> None:
    _, headers, cats = user
    key = str(uuid.uuid4())
    body = body_for(cats)
    created = post(db_client, headers, body, key).json()
    db_client.patch(f"{API}/{created['id']}", headers=headers, json={"note": "edited"})

    replay = post(db_client, headers, body, key)

    assert replay.status_code == 200
    assert replay.json()["id"] == created["id"] and replay.json()["note"] == "edited"


def test_a_late_retry_does_not_bring_back_a_deleted_expense(
    db_client: TestClient, user, admin_engine: Engine
) -> None:
    user_id, headers, cats = user
    key = str(uuid.uuid4())
    body = body_for(cats)
    created = post(db_client, headers, body, key).json()
    assert db_client.delete(f"{API}/{created['id']}", headers=headers).status_code == 204

    late = post(db_client, headers, body, key)

    assert late.status_code == 409
    assert count_transactions(admin_engine, user_id) == 0
    # Undo in the app sends a NEW key for the restore, which records it again.
    restored = post(db_client, headers, body, str(uuid.uuid4()))
    assert restored.status_code == 201
    assert count_transactions(admin_engine, user_id) == 1


# ---------- failures and retries ----------


def test_a_failed_attempt_leaves_no_key_so_the_retry_succeeds_once(
    db_client: TestClient, user, admin_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The server fails after inserting the transaction (before commit): everything, the key
    included, is rolled back, and the client's retry with the same key records it once."""
    user_id, headers, cats = user
    key = str(uuid.uuid4())
    body = body_for(cats)
    real = notifications.budget_alerts
    calls = {"n": 0}

    def flaky(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("simulated crash after the insert")
        return real(*args, **kwargs)

    monkeypatch.setattr(notifications, "budget_alerts", flaky)

    failed = post(db_client, headers, body, key)
    assert failed.status_code == 500
    assert count_transactions(admin_engine, user_id) == 0
    with admin_engine.connect() as conn:
        assert (
            conn.execute(
                text("select count(*) from idempotency_keys where user_id = :u"), {"u": user_id}
            ).scalar_one()
            == 0
        )

    retried = post(db_client, headers, body, key)
    assert retried.status_code == 201
    assert post(db_client, headers, body, key).status_code == 200
    assert count_transactions(admin_engine, user_id) == 1


def test_a_rejected_request_can_be_corrected_and_resent_with_the_same_key(
    db_client: TestClient, user, admin_engine: Engine
) -> None:
    """A 422 (nothing saved) doesn't burn the key: the corrected request uses it."""
    user_id, headers, cats = user
    key = str(uuid.uuid4())
    bad = post(db_client, headers, body_for(cats, category_id=str(uuid.uuid4())), key)
    assert bad.status_code == 422
    good = post(db_client, headers, body_for(cats), key)
    assert good.status_code == 201
    assert count_transactions(admin_engine, user_id) == 1


# ---------- concurrency ----------


def test_simultaneous_requests_with_one_key_record_one_expense(
    db_client: TestClient, user, admin_engine: Engine
) -> None:
    user_id, headers, cats = user
    key = str(uuid.uuid4())
    body = body_for(cats)
    start = threading.Barrier(8)

    def send(_: int):  # noqa: ANN202
        start.wait()
        return post(db_client, headers, body, key)

    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(send, range(8)))

    statuses = sorted(r.status_code for r in responses)
    assert statuses == [200] * 7 + [201], [r.text for r in responses]
    assert len({r.json()["id"] for r in responses}) == 1
    assert count_transactions(admin_engine, user_id) == 1


def _session(app_engine: Engine, user_id: uuid.UUID) -> Session:
    from app.core.db import make_session_factory, scope_session_to_user

    session = make_session_factory(app_engine)()
    session.begin()
    scope_session_to_user(session, user_id)
    return session


def _create_in(session: Session, user_id: uuid.UUID, data: TransactionCreate, key: str):  # noqa: ANN202
    current = CurrentUser(id=user_id, email=None, claims={})
    return service.create_transaction(session, current, data, key)


@pytest.mark.parametrize("first_outcome", ["commit", "rollback"])
def test_a_second_request_waits_for_the_first_then_replays_or_takes_over(
    app_engine: Engine, user, admin_engine: Engine, first_outcome: str
) -> None:
    """Deterministic interleaving: request B arrives while A holds the key uncommitted. B waits
    on the unique index; if A commits, B replays A's transaction; if A rolls back, B records
    the expense itself. Either way exactly one transaction exists."""
    user_id, _, cats = user
    data = TransactionCreate.model_validate(body_for(cats))
    key = str(uuid.uuid4())

    a = _session(app_engine, user_id)
    saved_a, replayed_a = _create_in(a, user_id, data, key)
    assert replayed_a is False

    result: dict = {}

    def run_b() -> None:
        b = _session(app_engine, user_id)
        try:
            result["value"] = _create_in(b, user_id, data, key)
            b.commit()
        except Exception as exc:  # noqa: BLE001
            result["error"] = exc
            b.rollback()
        finally:
            b.close()

    thread = threading.Thread(target=run_b)
    thread.start()
    time.sleep(0.5)
    assert thread.is_alive(), "B should be waiting for A's key"

    if first_outcome == "commit":
        a.commit()
    else:
        a.rollback()
    a.close()
    thread.join(timeout=10)
    assert not thread.is_alive()
    assert "error" not in result, result.get("error")

    saved_b, replayed_b = result["value"]
    if first_outcome == "commit":
        assert replayed_b is True and saved_b.id == saved_a.id
    else:
        assert replayed_b is False and saved_b.id != saved_a.id
    assert count_transactions(admin_engine, user_id) == 1


# ---------- isolation between users ----------


def test_the_same_key_from_two_users_never_collides(
    db_client: TestClient, make_user, auth_header, admin_engine: Engine
) -> None:
    alice, bob = make_user(), make_user()
    ha, hb = auth_header(alice), auth_header(bob)
    cats = {c["name"]: c["id"] for c in db_client.get("/api/v1/categories", headers=ha).json()}
    key = str(uuid.uuid4())

    a = post(db_client, ha, body_for(cats, amount="10.00"), key)
    b = post(db_client, hb, body_for(cats, amount="20.00"), key)  # different data, same key

    assert a.status_code == 201 and b.status_code == 201
    assert a.json()["id"] != b.json()["id"]
    assert b.json()["amount"] == "20.00"
    # Bob's replay is Bob's own transaction, never Alice's.
    again = post(db_client, hb, body_for(cats, amount="20.00"), key)
    assert again.status_code == 200 and again.json()["id"] == b.json()["id"]
    assert count_transactions(admin_engine, alice) == 1
    assert count_transactions(admin_engine, bob) == 1


def test_rls_hides_other_users_keys_and_blocks_linking_their_transactions(
    db_client: TestClient, make_user, auth_header, as_user: Callable, admin_engine: Engine
) -> None:
    alice, bob = make_user(), make_user()
    ha = auth_header(alice)
    cats = {c["name"]: c["id"] for c in db_client.get("/api/v1/categories", headers=ha).json()}
    created = post(db_client, ha, body_for(cats), str(uuid.uuid4())).json()

    bob_db = as_user(bob)
    assert bob_db.execute(text("select count(*) from idempotency_keys")).scalar_one() == 0
    assert as_user(alice).execute(text("select count(*) from idempotency_keys")).scalar_one() == 1
    with pytest.raises(DBAPIError):
        bob_db.execute(
            text(
                "insert into idempotency_keys (user_id, scope, key, request_hash, transaction_id)"
                " values (:u, 'transactions.create', 'bob-key-123', repeat('b', 64), :t)"
            ),
            {"u": bob, "t": created["id"]},
        )


def test_a_key_row_for_another_user_cannot_be_inserted(as_user: Callable, make_user) -> None:
    alice, bob = make_user(), make_user()
    with pytest.raises(DBAPIError):
        as_user(bob).execute(
            text(
                "insert into idempotency_keys (user_id, scope, key, request_hash)"
                " values (:u, 'transactions.create', 'stolen-key-1', repeat('c', 64))"
            ),
            {"u": alice},
        )


def test_request_hash_ignores_representation_only() -> None:
    from app.modules.expenses.idempotency import request_hash

    cat = str(uuid.uuid4())
    base = {"amount": "95", "category_id": cat, "occurred_at": "2026-11-14T08:00:00+08:00"}
    same = {"amount": "95.00", "category_id": cat, "occurred_at": "2026-11-14T00:00:00Z"}
    other = {**base, "amount": Decimal("95.01")}

    def h(d: dict) -> str:
        return request_hash(TransactionCreate.model_validate(d))

    assert h(base) == h(same)
    assert h(base) != h(other)
    assert len(h(base)) == 64
