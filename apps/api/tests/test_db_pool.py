"""Connection-pool reliability (stale Supabase connections after idle).

Root cause being guarded: SQLAlchemy's psycopg `pool_pre_ping` switches autocommit back in a
`finally`. When the socket died mid-ping (e.g. "Can't assign requested address" after sleep or
a network change), psycopg still reports the ping as ACTIVE, so that raises "can't change
'autocommit' now", hiding the disconnect: the stale connection stayed in the pool and the
request failed with a 500. `ping_on_checkout` replaces it.

The unit tests model the failing socket with a stand-in connection. The database tests make
connections stale the controlled way, by terminating their server backends on the throwaway
test database (never Supabase).
"""

import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.pq import TransactionStatus
from sqlalchemy import Engine, exc, text
from sqlalchemy.dialects.postgresql.psycopg import PGDialect_psycopg

import app.main
from app.core.db import make_engine, ping_on_checkout
from app.modules.expenses import transaction_service

# ---------- unit: the checkout ping ----------


class FakeConnection:
    """Just enough of psycopg.Connection to model a socket that dies mid-query."""

    def __init__(self, *, fail_with: Exception | None = None) -> None:
        self.closed = False
        self.broken = False
        self._autocommit = False
        self.fail_with = fail_with
        self.status = TransactionStatus.IDLE
        self.executed: list[str] = []

    @property
    def info(self):  # noqa: ANN201
        return self

    @property
    def transaction_status(self) -> TransactionStatus:
        return self.status

    @property
    def autocommit(self) -> bool:
        return self._autocommit

    @autocommit.setter
    def autocommit(self, value: bool) -> None:
        # Like psycopg: only allowed while no query/transaction is in progress.
        if self.status != TransactionStatus.IDLE:
            raise psycopg.ProgrammingError(
                "can't change 'autocommit' now: connection in transaction status ACTIVE"
            )
        self._autocommit = value

    def execute(self, query: str) -> None:
        self.executed.append(query)
        if self.fail_with is not None:
            self.status = TransactionStatus.ACTIVE  # the socket died mid-query
            raise self.fail_with

    def cursor(self):  # noqa: ANN201 - for SQLAlchemy's own do_ping
        return FakeCursor(self)


class FakeCursor:
    def __init__(self, conn: FakeConnection) -> None:
        self.conn = conn

    def execute(self, query: str) -> None:
        self.conn.execute(query)

    def close(self) -> None:
        pass


DEAD_SOCKET = psycopg.OperationalError(
    "consuming input failed: could not receive data from server: Can't assign requested address"
)


def test_sqlalchemy_pre_ping_masks_the_disconnect_on_a_socket_that_died_mid_ping() -> None:
    """Documents the root cause: the original error is replaced by a ProgrammingError, which
    SQLAlchemy does not treat as a disconnect, so the pool kept the dead connection."""
    dialect = PGDialect_psycopg()
    with pytest.raises(psycopg.ProgrammingError, match="can't change 'autocommit' now"):
        dialect.do_ping(FakeConnection(fail_with=DEAD_SOCKET))


def test_checkout_ping_reports_a_dead_socket_as_a_disconnect_without_touching_autocommit() -> None:
    conn = FakeConnection(fail_with=DEAD_SOCKET)
    with pytest.raises(exc.InvalidatePoolError) as raised:
        ping_on_checkout(conn, None, None)  # type: ignore[arg-type]
    # A DisconnectionError makes the pool discard the connection and reconnect; the
    # InvalidatePoolError variant also retires the other connections that idled through it.
    assert isinstance(raised.value, exc.DisconnectionError)
    assert raised.value.invalidate_pool is True
    assert raised.value.__cause__ is DEAD_SOCKET


@pytest.mark.parametrize("state", ["closed", "broken", "mid-transaction"])
def test_checkout_ping_discards_unusable_connections_without_querying(state: str) -> None:
    conn = FakeConnection()
    if state == "mid-transaction":
        conn.status = TransactionStatus.INTRANS
    else:
        setattr(conn, state, True)
    with pytest.raises(exc.DisconnectionError) as raised:
        ping_on_checkout(conn, None, None)  # type: ignore[arg-type]
    assert raised.value.invalidate_pool is False  # only this connection
    assert conn.executed == []


def test_checkout_ping_passes_a_healthy_connection_and_restores_autocommit() -> None:
    conn = FakeConnection()
    ping_on_checkout(conn, None, None)  # type: ignore[arg-type]
    assert conn.executed == ["select 1"]
    assert conn.autocommit is False
    assert conn.status == TransactionStatus.IDLE


# ---------- database: recovery with real connections ----------

pg = pytest.mark.db


def backend_pid(engine: Engine) -> int:
    with engine.connect() as conn:
        return conn.execute(text("select pg_backend_pid()")).scalar_one()


def kill(admin_engine: Engine, *pids: int) -> None:
    """Terminate server backends, as an idle timeout or dropped network would."""
    with admin_engine.begin() as conn:
        for pid in pids:
            conn.execute(text("select pg_terminate_backend(:pid)"), {"pid": pid})


def pooled_pids(engine: Engine, admin_engine: Engine) -> list[int]:
    """Backends currently held by this engine's pool (application_name tags them)."""
    name = engine.url.query.get("application_name")
    with admin_engine.connect() as conn:
        return list(
            conn.execute(
                text("select pid from pg_stat_activity where application_name = :n"),
                {"n": name},
            ).scalars()
        )


@pytest.fixture
def fresh_engine(database) -> Iterator[Engine]:  # noqa: ANN001
    """A separate pool (tagged so its backends can be found) for each test."""
    url = database.app_url + ("&" if "?" in database.app_url else "?")
    engine = make_engine(url + f"application_name=pooltest_{uuid.uuid4().hex[:8]}")
    yield engine
    engine.dispose()


class HalfDeadConnection(psycopg.Connection):
    """A real psycopg connection whose socket can be made to die mid-query, as after laptop
    sleep: the query fails, psycopg still reports it ACTIVE, and the connection isn't closed."""

    dead = False
    active = False

    @property
    def info(self):  # noqa: ANN201
        real = super().info
        if not self.active:
            return real
        return type("Info", (), {"transaction_status": TransactionStatus.ACTIVE})()

    @property
    def autocommit(self) -> bool:
        return super().autocommit

    @autocommit.setter
    def autocommit(self, value: bool) -> None:
        if self.active:
            raise psycopg.ProgrammingError(
                "can't change 'autocommit' now: connection in transaction status ACTIVE"
            )
        psycopg.Connection.autocommit.fset(self, value)  # type: ignore[attr-defined]

    def _die(self) -> None:
        self.active = True
        raise psycopg.OperationalError(str(DEAD_SOCKET))

    def execute(self, *args, **kwargs):  # noqa: ANN002, ANN003, ANN201
        if self.dead:
            self._die()
        return super().execute(*args, **kwargs)

    def cursor(self, *args, **kwargs):  # noqa: ANN002, ANN003, ANN201
        if self.dead:  # SQLAlchemy's own ping only executes and closes
            return FakeCursor(self)  # its execute calls self.execute, which dies
        return super().cursor(*args, **kwargs)


@pg
def test_a_half_dead_pooled_connection_no_longer_fails_the_request(
    database,  # noqa: ANN001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """End to end through a real engine and pool: the exact failure seen in development."""
    opened: list[HalfDeadConnection] = []

    def connect(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        conn = HalfDeadConnection.connect(*args, **kwargs)
        opened.append(conn)
        return conn

    monkeypatch.setattr(psycopg, "connect", connect)
    engine = make_engine(database.app_url)
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
        opened[0].dead = True  # idles in the pool, then the network drops

        with engine.connect() as conn:  # was: ProgrammingError "can't change 'autocommit'"
            assert conn.execute(text("select 1")).scalar_one() == 1
        assert len(opened) == 2  # the half-dead one was replaced
    finally:
        engine.dispose()


@pg
def test_a_stale_pooled_connection_is_replaced_on_checkout(
    fresh_engine: Engine, admin_engine: Engine
) -> None:
    old_pid = backend_pid(fresh_engine)  # back in the pool, idle
    kill(admin_engine, old_pid)

    # No error: the ping fails, the pool reconnects, the query runs on a new backend.
    new_pid = backend_pid(fresh_engine)
    assert new_pid != old_pid


@pg
def test_after_an_outage_every_stale_connection_is_retired_and_requests_recover(
    fresh_engine: Engine, admin_engine: Engine
) -> None:
    # Fill the pool with three idle connections, then "sleep the laptop".
    conns = [fresh_engine.connect() for _ in range(3)]
    for c in conns:
        c.execute(text("select 1"))
    for c in conns:
        c.close()
    stale = pooled_pids(fresh_engine, admin_engine)
    assert len(stale) == 3
    kill(admin_engine, *stale)

    for _ in range(5):  # every later checkout succeeds; none reuse a dead backend
        assert backend_pid(fresh_engine) not in stale


@pg
def test_health_check_recovers_after_idle_instead_of_returning_500(
    fresh_engine: Engine, admin_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(app.main, "get_engine", lambda: fresh_engine)
    client = TestClient(app.main.app, raise_server_exceptions=False)
    assert client.get("/health/db").status_code == 200
    kill(admin_engine, *pooled_pids(fresh_engine, admin_engine))

    responses = [client.get("/health/db") for _ in range(3)]

    assert [r.status_code for r in responses] == [200, 200, 200]
    assert responses[0].json() == {"database": "ok"}


@pg
def test_requests_recover_with_auth_and_rls_intact_after_stale_connections(
    db_client: TestClient,
    app_engine: Engine,
    admin_engine: Engine,
    make_user: Callable[..., uuid.UUID],
    auth_header: Callable[..., dict[str, str]],
) -> None:
    alice, bob = auth_header(make_user()), auth_header(make_user())
    cats = {c["name"]: c["id"] for c in db_client.get("/api/v1/categories", headers=alice).json()}
    body = {
        "amount": "12.50",
        "category_id": cats["Groceries"],
        "occurred_at": datetime.now(UTC).isoformat(),
        "merchant": "ZZ Test pool",
    }
    assert db_client.post("/api/v1/transactions", headers=alice, json=body).status_code == 201

    # Make every idle connection in the API's pool stale.
    with admin_engine.connect() as conn:
        pids = conn.execute(
            text(
                "select pid from pg_stat_activity"
                " where datname = current_database() and usename = 'lunti_migrator'"
                " and state = 'idle'"
            )
        ).scalars()
        kill(admin_engine, *pids)

    mine = db_client.get("/api/v1/transactions", headers=alice)
    theirs = db_client.get("/api/v1/transactions", headers=bob)
    assert mine.status_code == 200 and theirs.status_code == 200
    assert [t["merchant"] for t in mine.json()["items"]] == ["ZZ Test pool"]
    assert theirs.json()["items"] == []  # RLS and the user filter still apply
    assert db_client.get("/api/v1/transactions").status_code == 401  # auth still required


@pg
def test_a_connection_lost_during_a_financial_write_rolls_back_and_is_not_replayed(
    db_client: TestClient,
    admin_engine: Engine,
    make_user: Callable[..., uuid.UUID],
    auth_header: Callable[..., dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = make_user()
    headers = auth_header(user_id)
    cats = {c["name"]: c["id"] for c in db_client.get("/api/v1/categories", headers=headers).json()}
    body = {
        "amount": "40.00",
        "category_id": cats["Groceries"],
        "occurred_at": datetime.now(UTC).isoformat(),
        "merchant": "ZZ Test write",
    }
    real_recalculate = transaction_service.budget_service.recalculate
    calls = 0

    def drop_connection_then_recalculate(db, user, category_ids):  # noqa: ANN001, ANN202
        # The row is inserted (flushed) but not committed when the connection dies.
        nonlocal calls
        calls += 1
        kill(admin_engine, db.execute(text("select pg_backend_pid()")).scalar_one())
        return real_recalculate(db, user, category_ids)

    monkeypatch.setattr(
        transaction_service.budget_service, "recalculate", drop_connection_then_recalculate
    )
    failed = db_client.post("/api/v1/transactions", headers=headers, json=body)

    assert failed.status_code == 503  # retryable for the user, not a 500
    assert failed.json()["type"].endswith("service-unavailable")
    assert calls == 1  # the write was not retried behind the user's back

    def count() -> int:
        with admin_engine.connect() as conn:
            return conn.execute(
                text("select count(*) from transactions where user_id = :u"), {"u": user_id}
            ).scalar_one()

    assert count() == 0  # nothing half-saved

    monkeypatch.setattr(transaction_service.budget_service, "recalculate", real_recalculate)
    assert db_client.post("/api/v1/transactions", headers=headers, json=body).status_code == 201
    assert count() == 1  # the user's retry saves exactly one
