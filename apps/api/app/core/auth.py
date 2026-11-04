"""Supabase access-token verification (AGENTS.md §3: FastAPI verifies the JWT on every request).

Supabase projects sign tokens with an asymmetric key (ES256/RS256) published at
`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`; older projects use a shared HS256 secret.
Both are supported. The token must have a valid signature, `exp`, `iss` = this project,
`aud` = "authenticated", `role` = "authenticated", and a UUID `sub`.
"""

import ssl
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Annotated, Any, Protocol
from uuid import UUID

import certifi
import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.core.errors import ApiError

ASYMMETRIC_ALGORITHMS = ["ES256", "RS256"]
CLOCK_SKEW_SECONDS = 10


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    email: str | None
    claims: dict[str, Any] = field(repr=False)


class SigningKeySource(Protocol):
    def get_signing_key_from_jwt(self, token: str) -> Any: ...


def unauthorized(detail: str) -> ApiError:
    return ApiError(
        401,
        "unauthorized",
        detail,
        headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
    )


class TokenVerifier:
    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        jwks: SigningKeySource | None,
        hs256_secret: str = "",
    ) -> None:
        self.issuer = issuer
        self.audience = audience
        self.jwks = jwks
        self.hs256_secret = hs256_secret

    def verify(self, token: str) -> CurrentUser:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise unauthorized("The access token is malformed.") from exc

        alg = header.get("alg")
        try:
            if alg in ASYMMETRIC_ALGORITHMS and self.jwks is not None:
                key: Any = self.jwks.get_signing_key_from_jwt(token).key
                algorithms = ASYMMETRIC_ALGORITHMS
            elif alg == "HS256" and self.hs256_secret:
                key, algorithms = self.hs256_secret, ["HS256"]
            else:
                raise unauthorized("The access token uses an unsupported signing algorithm.")

            claims = jwt.decode(
                token,
                key,
                algorithms=algorithms,
                audience=self.audience,
                issuer=self.issuer,
                leeway=CLOCK_SKEW_SECONDS,
                options={"require": ["exp", "iat", "sub", "aud", "iss"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise unauthorized("The access token has expired.") from exc
        except jwt.PyJWKClientConnectionError as exc:
            # Can't fetch Supabase's public keys: a server-side problem, not the client's.
            raise ApiError(
                503, "service-unavailable", "Sign-in can't be verified right now."
            ) from exc
        except (jwt.PyJWTError, jwt.PyJWKClientError) as exc:
            raise unauthorized("The access token is invalid.") from exc

        if claims.get("role") != "authenticated" or claims.get("is_anonymous") is True:
            raise unauthorized("A signed-in user account is required.")
        try:
            user_id = UUID(str(claims["sub"]))
        except ValueError as exc:
            raise unauthorized("The access token is invalid.") from exc

        email = claims.get("email")
        return CurrentUser(
            id=user_id, email=email if isinstance(email, str) else None, claims=claims
        )


@lru_cache
def get_token_verifier() -> TokenVerifier:
    """App-wide verifier. Tests override this dependency with their own keys."""
    if not settings.supabase_url:
        raise ApiError(503, "service-unavailable", "Authentication is not configured.")
    jwks = jwt.PyJWKClient(
        settings.supabase_jwks_url,
        cache_keys=True,
        lifespan=600,
        timeout=5,
        # Use certifi's CA bundle: some Python installs (e.g. python.org on macOS) ship
        # without system certificates, which would make every key download fail.
        ssl_context=ssl.create_default_context(cafile=certifi.where()),
    )
    return TokenVerifier(
        issuer=settings.supabase_issuer,
        audience=settings.supabase_jwt_audience,
        jwks=jwks,
        hs256_secret=settings.supabase_jwt_secret,
    )


_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    verifier: Annotated[TokenVerifier, Depends(get_token_verifier)],
) -> CurrentUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise ApiError(
            401,
            "unauthorized",
            "Sign in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return verifier.verify(credentials.credentials)


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
