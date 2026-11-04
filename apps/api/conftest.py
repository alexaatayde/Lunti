"""Shared pytest fixtures.

Unit tests need nothing. Database tests need TEST_DATABASE_URL pointing at a PostgreSQL
server where the user can CREATE DATABASE and CREATE ROLE (a local server or the CI service
container — never Supabase). Each test session creates a throwaway database, loads
tests/supabase_stub.sql, runs the Alembic migrations, and drops the database afterwards.
Without TEST_DATABASE_URL the database tests are skipped.
"""

import json
import os
import time
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import jwt
import pytest
from alembic.config import Config
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, make_url, text
from sqlalchemy.orm import Session

from alembic import command
from app.core.auth import TokenVerifier, get_token_verifier
from app.core.config import to_sqlalchemy_url
from app.core.db import (
    get_session_factory,
    make_engine,
    make_session_factory,
    scope_session_to_user,
)
from app.main import app

API_DIR = Path(__file__).parent
ISSUER = "https://test-project.supabase.co/auth/v1"
AUDIENCE = "authenticated"
KID = "test-key-1"
MIGRATOR = "lunti_migrator"


# ---------- tokens ----------


class TokenFactory:
    """Signs Supabase-shaped access tokens with a local ES256 key."""

    def __init__(self) -> None:
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        public_jwk = jwt.algorithms.ECAlgorithm.to_jwk(self.private_key.public_key(), as_dict=True)
        self.jwks = {"keys": [{**public_jwk, "kid": KID, "alg": "ES256", "use": "sig"}]}

    def make(
        self,
        user_id: uuid.UUID | str,
        *,
        email: str | None = "user@example.com",
        key: Any = None,
        headers: dict[str, Any] | None = None,
        algorithm: str = "ES256",
        **overrides: Any,
    ) -> str:
        now = int(time.time())
        claims: dict[str, Any] = {
            "sub": str(user_id),
            "aud": AUDIENCE,
            "iss": ISSUER,
            "iat": now,
            "exp": now + 3600,
            "role": "authenticated",
            "email": email,
            "is_anonymous": False,
            "user_metadata": {},
        }
        claims.update(overrides)
        claims = {k: v for k, v in claims.items() if v is not None}
        return jwt.encode(
            claims,
            key if key is not None else self.private_key,
            algorithm=algorithm,
            headers={"kid": KID, **(headers or {})},
        )


@pytest.fixture(scope="session")
def tokens() -> TokenFactory:
    return TokenFactory()


@pytest.fixture(scope="session")
def verifier(tokens: TokenFactory) -> TokenVerifier:
    # A real PyJWKClient whose download is replaced by the local key set.
    jwks_client = jwt.PyJWKClient("https://test-project.supabase.co/auth/v1/.well-known/jwks.json")
    jwks_client.fetch_data = lambda: tokens.jwks  # type: ignore[method-assign]
    return TokenVerifier(issuer=ISSUER, audience=AUDIENCE, jwks=jwks_client)


@pytest.fixture
def client(verifier: TokenVerifier) -> Iterator[TestClient]:
    app.dependency_overrides[get_token_verifier] = lambda: verifier
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()


# ---------- database ----------


@dataclass
class ThrowawayDatabase:
    admin_url: str  # superuser, this database
    app_url: str  # non-superuser owner, like `postgres` on Supabase

    def admin_engine(self) -> Engine:
        # Normal transactions (not autocommit) so `SET LOCAL ROLE` in tests takes effect.
        return create_engine(to_sqlalchemy_url(self.admin_url))


def _server_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set: database tests skipped")
    return url


def alembic_config(url: str) -> Config:
    config = Config(str(API_DIR / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    config.attributes["configure_logger"] = False
    return config


def create_database(server_url: str) -> ThrowawayDatabase:
    """Throwaway database with the Supabase stand-in loaded (not yet migrated)."""
    name = f"lunti_test_{uuid.uuid4().hex[:10]}"
    server = create_engine(to_sqlalchemy_url(server_url), isolation_level="AUTOCOMMIT")
    with server.connect() as conn:
        conn.execute(
            text(
                "do $$ begin if not exists"
                " (select 1 from pg_roles where rolname = 'lunti_migrator')"
                " then create role lunti_migrator login createrole password 'lunti_migrator';"
                " end if; end $$;"
            )
        )
        conn.execute(text(f'create database "{name}" owner {MIGRATOR}'))
    server.dispose()

    admin_url = make_url(to_sqlalchemy_url(server_url)).set(database=name)
    app_url = admin_url.set(username=MIGRATOR, password=MIGRATOR)
    db = ThrowawayDatabase(
        admin_url=admin_url.render_as_string(hide_password=False),
        app_url=app_url.render_as_string(hide_password=False),
    )
    engine = db.admin_engine()
    with engine.begin() as conn:
        conn.exec_driver_sql((API_DIR / "tests" / "supabase_stub.sql").read_text())
    engine.dispose()
    return db


def drop_database(server_url: str, db: ThrowawayDatabase) -> None:
    name = make_url(db.admin_url).database
    server = create_engine(to_sqlalchemy_url(server_url), isolation_level="AUTOCOMMIT")
    with server.connect() as conn:
        conn.execute(text(f'drop database if exists "{name}" with (force)'))
    server.dispose()


@pytest.fixture(scope="session")
def database() -> Iterator[ThrowawayDatabase]:
    server_url = _server_url()
    db = create_database(server_url)
    try:
        command.upgrade(alembic_config(db.app_url), "head")
        yield db
    finally:
        drop_database(server_url, db)


@pytest.fixture(scope="session")
def fresh_database_factory() -> Iterator[Callable[[], ThrowawayDatabase]]:
    """Unmigrated databases for migration tests; all dropped at the end."""
    server_url = _server_url()
    created: list[ThrowawayDatabase] = []

    def factory() -> ThrowawayDatabase:
        db = create_database(server_url)
        created.append(db)
        return db

    yield factory
    for db in created:
        drop_database(server_url, db)


@pytest.fixture(scope="session")
def admin_engine(database: ThrowawayDatabase) -> Iterator[Engine]:
    engine = database.admin_engine()
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def app_engine(database: ThrowawayDatabase) -> Iterator[Engine]:
    engine = make_engine(database.app_url)
    yield engine
    engine.dispose()


@pytest.fixture
def db_client(client: TestClient, app_engine: Engine) -> TestClient:
    """API client wired to the migrated throwaway database."""
    factory = make_session_factory(app_engine)
    app.dependency_overrides[get_session_factory] = lambda: factory
    return client


def insert_auth_user(
    engine: Engine,
    *,
    email: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> uuid.UUID:
    """Create a user the way Supabase Auth does (as supabase_auth_admin), firing the trigger."""
    user_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text("set local role supabase_auth_admin"))
        conn.execute(
            text(
                "insert into auth.users (id, email, raw_user_meta_data)"
                " values (:id, :email, cast(:meta as jsonb))"
            ),
            {
                "id": user_id,
                "email": email or f"{user_id.hex[:8]}@example.com",
                "meta": json.dumps(metadata) if metadata is not None else None,
            },
        )
    return user_id


@pytest.fixture
def make_user(admin_engine: Engine) -> Callable[..., uuid.UUID]:
    def factory(**kwargs: Any) -> uuid.UUID:
        return insert_auth_user(admin_engine, **kwargs)

    return factory


@pytest.fixture
def as_user(app_engine: Engine) -> Iterator[Callable[[uuid.UUID | None], Session]]:
    """A session that behaves exactly like an API request for the given user (RLS on).
    Pass None for a session with the app role but no caller."""
    sessions: list[Session] = []

    def open_session(user_id: uuid.UUID | None) -> Session:
        session = make_session_factory(app_engine)()
        session.begin()
        if user_id is None:
            session.execute(text("select set_config('role', 'lunti_app_user', true)"))
        else:
            scope_session_to_user(session, user_id)
        sessions.append(session)
        return session

    yield open_session
    for session in sessions:
        session.rollback()
        session.close()


@pytest.fixture
def auth_header(tokens: TokenFactory) -> Callable[..., dict[str, str]]:
    def build(user_id: uuid.UUID, **kwargs: Any) -> dict[str, str]:
        return {"Authorization": f"Bearer {tokens.make(user_id, **kwargs)}"}

    return build
