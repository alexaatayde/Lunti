from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend settings, read from apps/api/.env (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Postgres connection string (Supabase: Project Settings → Database → Connection string).
    database_url: str = ""
    db_pool_size: int = 5
    db_max_overflow: int = 5

    supabase_url: str = ""
    # Only for projects still on the legacy shared-secret (HS256) JWT signing.
    # Projects with asymmetric signing keys (ES256/RS256) are verified via JWKS instead.
    supabase_jwt_secret: str = ""
    supabase_jwt_audience: str = "authenticated"
    supabase_service_role_key: str = ""

    google_application_credentials: str = ""
    openai_api_key: str = ""
    openai_model: str = ""
    fcm_credentials: str = ""
    tz: str = "Asia/Manila"

    @cached_property
    def supabase_issuer(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @cached_property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_issuer}/.well-known/jwks.json"

    @cached_property
    def sqlalchemy_database_url(self) -> str:
        return to_sqlalchemy_url(self.database_url)


def to_sqlalchemy_url(url: str) -> str:
    """Select the psycopg 3 driver for a plain postgresql:// URL."""
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


settings = Settings()
