"""Daily OCR limits (Phase 8D.4a) against a real database (needs TEST_DATABASE_URL)."""

import random
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError

from app.core.config import settings
from app.core.db import make_engine, make_session_factory, scope_session_to_user
from app.core.errors import ApiError
from app.modules.receipts import quota
from app.modules.receipts.ocr import OcrResult, OcrUnavailable
from app.modules.receipts.tests.test_receipts_api import (  # noqa: F401 - fixtures
    JPEG,
    fakes,
    headers_user_id,
    upload,
    user,
)
from scripts import ocr_usage

pytestmark = pytest.mark.db

MANILA = ZoneInfo("Asia/Manila")


@pytest.fixture
def day(monkeypatch: pytest.MonkeyPatch) -> Callable[[datetime], None]:
    """Each test counts on its own far-future Manila day (the counters are shared by the
    whole test database). Returns a setter to move the clock."""
    base = datetime(2040, 1, 1, 12, 0, tzinfo=MANILA) + timedelta(days=random.randrange(40_000))
    state = {"now": base}
    monkeypatch.setattr(quota, "now", lambda: state["now"])

    def move(moment: datetime) -> None:
        state["now"] = moment

    move.base = base  # type: ignore[attr-defined]
    return move


@pytest.fixture
def limits(monkeypatch: pytest.MonkeyPatch) -> Callable[..., None]:
    def set_limits(*, per_user: int = 50, app_wide: int = 50) -> None:
        monkeypatch.setattr(settings, "ocr_user_daily_limit", per_user)
        monkeypatch.setattr(settings, "ocr_global_daily_limit", app_wide)

    return set_limits


def counters(admin_engine: Engine, on: date) -> dict[str, tuple[int, int, int]]:
    with admin_engine.connect() as conn:
        rows = conn.execute(
            text(
                "select coalesce(user_id::text, 'app'), used, succeeded, failed"
                " from ocr_usage_daily where usage_date = :d"
            ),
            {"d": on},
        ).all()
    return {key: (used, ok, failed) for key, used, ok, failed in rows}


# ---------- Manila days ----------


def test_the_day_turns_at_manila_midnight() -> None:
    assert quota.usage_day(datetime(2026, 11, 15, 15, 59, 59, tzinfo=UTC)) == date(2026, 11, 15)
    assert quota.usage_day(datetime(2026, 11, 15, 16, 0, 0, tzinfo=UTC)) == date(2026, 11, 16)
    assert quota.seconds_until_reset(datetime(2026, 11, 15, 23, 59, 30, tzinfo=MANILA)) == 30
    assert quota.seconds_until_reset(datetime(2026, 11, 15, 16, 0, 0, tzinfo=UTC)) == 86400


def test_counts_reset_at_manila_midnight(
    db_client: TestClient,
    fakes,
    user,
    day,
    limits,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    headers, _ = user
    limits(per_user=1)
    evening = day.base.replace(hour=23, minute=59, second=58)
    day(evening)
    assert upload(db_client, headers).status_code == 201
    refused = upload(db_client, headers)
    assert refused.status_code == 429 and refused.headers["Retry-After"] == "2"

    day(evening + timedelta(seconds=3))  # 00:00:01 the next Manila day
    assert upload(db_client, headers).status_code == 201
    user_id = headers_user_id(headers)
    assert counters(admin_engine, evening.date())[user_id][0] == 1
    assert counters(admin_engine, evening.date() + timedelta(days=1))[user_id][0] == 1


# ---------- per-user limit ----------


def test_per_user_limit_refuses_before_anything_is_kept(
    db_client: TestClient,
    fakes,
    user,
    day,
    limits,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    ocr, storage = fakes
    headers, _ = user
    limits(per_user=2)
    assert [upload(db_client, headers).status_code for _ in range(2)] == [201, 201]
    client_id = str(uuid.uuid4())
    refused = upload(db_client, headers, client_id=client_id)
    assert refused.status_code == 429
    body = refused.json()
    assert body["type"].endswith("ocr-daily-limit")
    assert body["detail"] == (
        "You've reached today's limit of 2 receipt scans. You can still add this expense manually."
    )
    assert int(refused.headers["Retry-After"]) == quota.seconds_until_reset(day.base)
    assert ocr.calls == 2 and len(storage.objects) == 2  # no OCR, photo removed again
    with admin_engine.connect() as conn:
        assert (
            conn.execute(
                text("select count(*) from receipts where id = :id"), {"id": client_id}
            ).scalar_one()
            == 0
        )


def test_idempotent_replays_do_not_count(
    db_client: TestClient,
    fakes,
    user,
    day,
    limits,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    headers, _ = user
    limits(per_user=1)
    client_id = str(uuid.uuid4())
    assert upload(db_client, headers, client_id=client_id).status_code == 201
    for _ in range(3):
        assert upload(db_client, headers, client_id=client_id).status_code == 200
    assert counters(admin_engine, day.base.date())[headers_user_id(headers)][0] == 1


def test_users_have_separate_allowances(
    db_client: TestClient,
    fakes,
    make_user,
    auth_header,
    day,
    limits,  # noqa: ANN001, F811
) -> None:
    limits(per_user=1)
    alice, bob = auth_header(make_user()), auth_header(make_user())
    assert upload(db_client, alice).status_code == 201
    assert upload(db_client, alice).status_code == 429
    assert upload(db_client, bob).status_code == 201


# ---------- app-wide limit ----------


def test_app_wide_limit_holds_across_users(
    db_client: TestClient,
    fakes,
    make_user,
    auth_header,
    day,
    limits,
    admin_engine,  # noqa: ANN001, F811
) -> None:
    ocr, _ = fakes
    limits(app_wide=2)
    users = [auth_header(make_user()) for _ in range(3)]
    codes = [upload(db_client, h).status_code for h in users]
    assert codes == [201, 201, 503]
    refused = upload(db_client, users[2])
    assert "today's limit" in refused.json()["detail"]
    assert int(refused.headers["Retry-After"]) == quota.seconds_until_reset(day.base)
    assert ocr.calls == 2
    totals = counters(admin_engine, day.base.date())
    assert totals["app"] == (2, 2, 0)
    # A refused reservation changes nothing, the user's counter included.
    assert headers_user_id(users[2]) not in totals


def test_zero_app_wide_limit_stops_all_billed_ocr(
    db_client: TestClient,
    fakes,
    user,
    day,
    limits,  # noqa: ANN001, F811
) -> None:
    ocr, _ = fakes
    limits(app_wide=0)
    assert upload(db_client, user[0]).status_code == 503 and ocr.calls == 0


def test_fixture_ocr_never_uses_the_app_wide_allowance(
    db_client: TestClient,
    fakes,
    user,
    day,
    limits,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    ocr, _ = fakes
    ocr.name = "fixture"
    original = ocr.read
    ocr.read = lambda image: OcrResult(original(image).text, 0.95, "fixture")  # type: ignore[method-assign]
    limits(app_wide=0, per_user=5)
    response = upload(db_client, user[0])
    assert response.status_code == 201 and response.json()["simulated"] is True
    totals = counters(admin_engine, day.base.date())
    assert "app" not in totals and totals[headers_user_id(user[0])][0] == 1


def test_retries_after_failures_cannot_bypass_the_limit(
    db_client: TestClient,
    fakes,
    user,
    day,
    limits,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    ocr, _ = fakes
    headers, _ = user
    limits(app_wide=3)
    client_id = str(uuid.uuid4())
    ocr.down = True  # each attempt reaches Vision and fails (maybe billed)
    assert [upload(db_client, headers, client_id=client_id).status_code for _ in range(3)] == [
        503,
        503,
        503,
    ]
    ocr.down = False
    final = upload(db_client, headers, client_id=client_id)
    assert final.status_code == 503 and "today's limit" in final.json()["detail"]
    assert ocr.calls == 3
    assert counters(admin_engine, day.base.date())["app"] == (3, 0, 3)


def test_timeouts_are_counted_as_used_and_failed(
    db_client: TestClient,
    fakes,
    user,
    day,
    limits,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    ocr, _ = fakes

    def deadline(image: bytes) -> OcrResult:
        raise OcrUnavailable("DeadlineExceeded")

    ocr.read = deadline  # type: ignore[method-assign]
    limits()
    assert upload(db_client, user[0]).status_code == 503
    assert counters(admin_engine, day.base.date())["app"] == (1, 0, 1)


# ---------- concurrency, persistence, crashes ----------


def _reserve_in_thread(app_url: str, user_id: uuid.UUID, at: datetime, external: bool) -> str:
    engine = make_engine(app_url)
    try:
        with make_session_factory(engine)() as db, db.begin():
            scope_session_to_user(db, user_id)
            try:
                quota.reserve(db, external=external, at=at)
                return "ok"
            except ApiError as error:
                return str(error.status)
    finally:
        engine.dispose()


def test_concurrent_reservations_never_overshoot(
    database,
    make_user,
    day,
    limits,
    admin_engine: Engine,  # noqa: ANN001
) -> None:
    limits(per_user=1_000, app_wide=5)
    users = [make_user() for _ in range(12)]
    gate = threading.Barrier(len(users))

    def go(user_id: uuid.UUID) -> str:
        gate.wait()
        return _reserve_in_thread(database.app_url, user_id, day.base, True)

    with ThreadPoolExecutor(max_workers=len(users)) as pool:
        results = list(pool.map(go, users))
    assert results.count("ok") == 5 and results.count("503") == 7
    totals = counters(admin_engine, day.base.date())
    assert totals["app"][0] == 5
    assert sum(used for key, (used, _, _) in totals.items() if key != "app") == 5


def test_concurrent_reservations_of_one_user_hold_the_personal_limit(
    database,
    make_user,
    day,
    limits,
    admin_engine: Engine,  # noqa: ANN001
) -> None:
    limits(per_user=3, app_wide=1_000)
    user_id = make_user()
    gate = threading.Barrier(10)

    def go(_: int) -> str:
        gate.wait()
        return _reserve_in_thread(database.app_url, user_id, day.base, True)

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(go, range(10)))
    assert results.count("ok") == 3 and results.count("429") == 7
    assert counters(admin_engine, day.base.date())[str(user_id)][0] == 3


def test_counts_survive_a_restart_and_crashed_reservations_stay_counted(
    database,
    make_user,
    day,
    limits,
    admin_engine: Engine,  # noqa: ANN001
) -> None:
    limits(per_user=10, app_wide=2)
    user_id = make_user()
    # Process 1 reserves and "crashes" before recording any outcome.
    assert _reserve_in_thread(database.app_url, user_id, day.base, True) == "ok"
    # Process 2 (fresh engine, nothing in memory) sees the reservation.
    assert _reserve_in_thread(database.app_url, user_id, day.base, True) == "ok"
    assert _reserve_in_thread(database.app_url, user_id, day.base, True) == "503"
    assert counters(admin_engine, day.base.date())["app"] == (2, 0, 0)  # 2 unknown


def test_app_role_cannot_touch_the_counters_directly(
    as_user,
    make_user,  # noqa: ANN001
) -> None:
    session = as_user(make_user())
    with pytest.raises(DBAPIError, match="permission denied"):
        session.execute(text("select * from ocr_usage_daily"))


def test_reservations_need_a_signed_in_caller(as_user) -> None:  # noqa: ANN001
    session = as_user(None)
    with pytest.raises(DBAPIError, match="signed-in caller"):
        session.execute(text("select lunti_private.reserve_ocr_quota(current_date, 5, 5, true)"))


def test_counters_go_with_the_account(
    db_client: TestClient,
    fakes,
    make_user,
    auth_header,
    day,
    admin_engine: Engine,  # noqa: ANN001, F811
) -> None:
    user_id = make_user()
    assert upload(db_client, auth_header(user_id)).status_code == 201
    with admin_engine.begin() as conn:
        conn.execute(text("delete from auth.users where id = :id"), {"id": user_id})
    assert str(user_id) not in counters(admin_engine, day.base.date())


# ---------- usage report ----------


def test_usage_report_has_aggregates_only(
    db_client: TestClient,
    fakes,
    make_user,
    auth_header,
    day,
    limits,
    monkeypatch,  # noqa: ANN001, F811
) -> None:
    ocr, _ = fakes
    limits(per_user=1, app_wide=10)
    users = [make_user() for _ in range(2)]
    for user_id in users:
        assert upload(db_client, auth_header(user_id)).status_code == 201
    ocr.down = True
    upload(db_client, auth_header(make_user()))

    from app.core import db as db_module

    factory = db_client.app.dependency_overrides[db_module.get_session_factory]()
    monkeypatch.setattr(ocr_usage, "get_session_factory", lambda: factory)
    (today,) = ocr_usage.usage(1)
    assert today == {
        "date": day.base.date().isoformat(),
        "external_used": 3,
        "external_succeeded": 2,
        "external_failed": 1,
        "external_unknown": 0,
        "external_limit": 10,
        "scans_all_engines": 3,
        "users_scanning": 3,
        "users_at_limit": 3,
    }
    assert not any(str(u) in str(today) for u in users)
