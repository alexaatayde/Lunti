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

from fastapi import Depends
from sqlalchemy import DateTime, Engine, MetaData, create_engine, func, text
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
    return create_engine(
        url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_pre_ping=True,
        # Safe behind Supabase's transaction pooler, which can't keep prepared statements.
        connect_args={"prepare_threshold": None},
    )


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
