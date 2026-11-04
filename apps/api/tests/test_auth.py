"""Supabase JWT verification (AGENTS.md §3). No database needed."""

import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app.core.auth import TokenVerifier
from app.core.errors import ApiError
from conftest import AUDIENCE, ISSUER, TokenFactory

USER_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")


def assert_rejected(verifier: TokenVerifier, token: str, detail_contains: str = "") -> None:
    with pytest.raises(ApiError) as exc_info:
        verifier.verify(token)
    assert exc_info.value.status == 401
    assert detail_contains.lower() in exc_info.value.detail.lower()


def test_accepts_a_valid_supabase_token(verifier: TokenVerifier, tokens: TokenFactory) -> None:
    user = verifier.verify(tokens.make(USER_ID, email="alex@example.com"))

    assert user.id == USER_ID
    assert user.email == "alex@example.com"


def test_rejects_an_expired_token(verifier: TokenVerifier, tokens: TokenFactory) -> None:
    past = int(time.time()) - 3600
    assert_rejected(verifier, tokens.make(USER_ID, iat=past - 60, exp=past), "expired")


def test_tolerates_small_clock_skew(verifier: TokenVerifier, tokens: TokenFactory) -> None:
    just_now = int(time.time()) - 3
    assert verifier.verify(tokens.make(USER_ID, exp=just_now)).id == USER_ID


@pytest.mark.parametrize(
    ("overrides", "why"),
    [
        ({"iss": "https://other-project.supabase.co/auth/v1"}, "another project's issuer"),
        ({"aud": "anon"}, "wrong audience"),
        ({"role": "anon"}, "anon key, not a user"),
        ({"role": "service_role"}, "service role is not a user session"),
        ({"is_anonymous": True}, "anonymous sign-in"),
        ({"sub": "not-a-uuid"}, "subject is not a user id"),
        ({"exp": None}, "no expiry"),
        ({"sub": None}, "no subject"),
    ],
)
def test_rejects_tokens_with_bad_claims(
    verifier: TokenVerifier, tokens: TokenFactory, overrides: dict, why: str
) -> None:
    assert_rejected(verifier, tokens.make(USER_ID, **overrides))


def test_rejects_a_token_signed_by_another_key(
    verifier: TokenVerifier, tokens: TokenFactory
) -> None:
    attacker_key = ec.generate_private_key(ec.SECP256R1())
    assert_rejected(verifier, tokens.make(USER_ID, key=attacker_key), "invalid")


def test_rejects_an_unknown_key_id(verifier: TokenVerifier, tokens: TokenFactory) -> None:
    assert_rejected(verifier, tokens.make(USER_ID, headers={"kid": "unknown"}), "invalid")


def test_rejects_unsigned_and_hs256_tokens_when_no_secret_is_configured(
    verifier: TokenVerifier,
) -> None:
    claims = {"sub": str(USER_ID), "aud": AUDIENCE, "iss": ISSUER, "role": "authenticated"}
    unsigned = jwt.encode(claims, key=None, algorithm="none")
    hs256 = jwt.encode(claims, "a-guessable-secret-that-is-long-enough", algorithm="HS256")

    assert_rejected(verifier, unsigned, "unsupported")
    assert_rejected(verifier, hs256, "unsupported")


def test_legacy_hs256_projects_are_supported_with_their_secret() -> None:
    secret = "legacy-project-jwt-secret-with-enough-length"
    legacy = TokenVerifier(issuer=ISSUER, audience=AUDIENCE, jwks=None, hs256_secret=secret)
    now = int(time.time())
    claims = {
        "sub": str(USER_ID),
        "aud": AUDIENCE,
        "iss": ISSUER,
        "role": "authenticated",
        "iat": now,
        "exp": now + 60,
    }

    assert legacy.verify(jwt.encode(claims, secret, algorithm="HS256")).id == USER_ID
    assert_rejected(legacy, jwt.encode(claims, "wrong-secret-of-similar-length!!", "HS256"))


def test_rejects_garbage(verifier: TokenVerifier) -> None:
    assert_rejected(verifier, "not.a.jwt", "malformed")


# ---------- HTTP layer (fails before any database access) ----------


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer"},
        {"Authorization": "Basic dXNlcjpwYXNz"},
        {"Authorization": "Bearer not.a.jwt"},
    ],
)
def test_protected_endpoints_return_401_problem(client: TestClient, headers: dict) -> None:
    for method, path in [
        ("GET", "/api/v1/me"),
        ("GET", "/api/v1/me/preferences"),
        ("GET", "/api/v1/categories"),
        ("POST", "/api/v1/categories"),
    ]:
        response = client.request(method, path, headers=headers)

        assert response.status_code == 401, (method, path)
        assert response.headers["content-type"] == "application/problem+json"
        assert response.headers["www-authenticate"].startswith("Bearer")
        body = response.json()
        assert body["type"] == "urn:lunti:problem:unauthorized"
        assert body["status"] == 401


def test_expired_token_gets_a_clear_401(client: TestClient, tokens: TokenFactory) -> None:
    past = int(time.time()) - 600
    token = tokens.make(USER_ID, iat=past - 60, exp=past)

    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401
    assert response.json()["detail"] == "The access token has expired."
