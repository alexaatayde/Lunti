"""Database engine, ORM base and the per-request session.

Every user request runs in ONE transaction that switches to the restricted `lunti_app_user`
role and sets `request.jwt.claims` to the caller's id. Row Level Security policies read that
id, so even a query that forgot its `user_id` filter can't return another user's rows
(AGENTS.md §6: the API's DB role must respect RLS). Services still filter by `user_id`
explicitly; RLS is the second layer.
"""

import json
import uuid
from collections.abc import Iterator
from datetime import datetime
from functools import lru_cache
from typing import Annotated

import psycopg
from fastapi import Depends
from psycopg.pq import TransactionStatus
from sqlalchemy import DateTime, Engine, MetaData, create_engine, event, exc, func, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.core.auth import CurrentUser, CurrentUserDep
from app.core.config import settings
from app.core.errors import ApiError

# Role the API switches to for user requests (created by the initial migration).
APP_ROLE = "lunti_app_user"

# Predictable constraint names so Alembic migrations stay stable.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Kept current by a database trigger (lunti_private.set_updated_at).
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class IdMixin:
    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )


@lru_cache
def get_engine() -> Engine:
    if not settings.database_url:
        raise ApiError(503, "service-unavailable", "The database is not configured.")
    return make_engine(settings.sqlalchemy_database_url)


def make_engine(url: str) -> Engine:
    engine = create_engine(
        url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        # Not SQLAlchemy's pool_pre_ping: its psycopg ping switches autocommit back in a
        # `finally`, and on a socket that died mid-ping (e.g. "Can't assign requested address"
        # after sleep or a network change) psycopg still reports the query as ACTIVE, so that
        # raises "can't change 'autocommit' now". That ProgrammingError hides the disconnect,
        # the stale connection isn't discarded, and the request fails with a 500 (one per
        # stale connection in the pool). `ping_on_checkout` below replaces it.
        pool_pre_ping=False,
        pool_recycle=settings.db_pool_recycle_seconds,
        # Keep amounts, names and notes out of database error messages (and so out of logs).
        hide_parameters=not settings.log_sql_parameters,
        connect_args={
            # Safe behind Supabase's transaction pooler, which can't keep prepared statements.
            "prepare_threshold": None,
            "connect_timeout": settings.db_connect_timeout_seconds,
            # TCP keepalives let the OS notice a dead idle connection, so the checkout ping
            # fails fast instead of waiting minutes for a TCP timeout.
            "keepalives": 1,
            "keepalives_idle": settings.db_keepalive_idle_seconds,
            "keepalives_interval": 10,
            "keepalives_count": 3,
        },
    )
    event.listen(engine, "checkout", ping_on_checkout)
    return engine


def ping_on_checkout(dbapi_connection: psycopg.Connection, _record: object, _proxy: object) -> None:
    """Discard a pooled connection that is closed, broken or mid-transaction, or that doesn't
    answer `select 1`. Raising DisconnectionError makes the pool close it and hand out a fresh
    connection instead (SQLAlchemy's documented pessimistic disconnect handling); a failed
    ping also retires the rest of the pool.

    Runs before the request opens its transaction, so nothing is ever retried after a
    statement or commit: a failure later in a request is reported (503), never replayed.
    """
    conn = dbapi_connection
    if conn.closed or conn.broken:
        raise exc.DisconnectionError("pooled connection is closed")
    # The pool rolls back every returned connection; anything else is not safe to reuse,
    # and autocommit may only change while idle.
    if conn.info.transaction_status != TransactionStatus.IDLE:
        raise exc.DisconnectionError("pooled connection is not idle")
    autocommit = conn.autocommit
    try:
        conn.autocommit = True  # no transaction left open by the ping
        conn.execute("select 1")
    except psycopg.Error as error:
        # Don't touch autocommit again here: the pool closes this connection. The others
        # idled through the same outage (sleep, network change), so retire them all at once
        # rather than paying a failed ping per request.
        raise exc.InvalidatePoolError(f"stale pooled connection: {error}") from error
    conn.autocommit = autocommit


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    """FastAPI dependency (tests override it to use a throwaway database)."""
    return make_session_factory(get_engine())


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


def scope_session_to_user(session: Session, user_id: uuid.UUID) -> None:
    """Switch the current transaction to the app role and set the caller for RLS."""
    claims = json.dumps({"sub": str(user_id), "role": "authenticated"})
    session.execute(
        text(
            "select set_config('request.jwt.claims', :claims, true),"
            " set_config('role', :role, true)"
        ),
        {"claims": claims, "role": APP_ROLE},
    )


def get_user_db(
    user: CurrentUserDep,
    factory: Annotated[sessionmaker[Session], Depends(get_session_factory)],
) -> Iterator[Session]:
    """One transaction per request, scoped to the signed-in user. Commits on success."""
    with factory() as session, session.begin():
        scope_session_to_user(session, user.id)
        yield session


# scope="function": commit/rollback happens before the response is sent, so a failed
# commit returns an error instead of a false success.
UserDbDep = Annotated[Session, Depends(get_user_db, scope="function")]

__all__ = ["Base", "CurrentUser", "UserDbDep", "get_user_db", "scope_session_to_user"]
