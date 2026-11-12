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

    # "development" or "production". Production refuses the development-only receipt
    # adapters below (fixture OCR, local storage) instead of silently using them.
    app_env: str = "development"

    # Receipt scanning (AGENTS.md §7.1).
    # Private Supabase Storage bucket for receipt images (create it once; see README).
    receipts_bucket: str = "receipts"
    # "supabase" (default; needs SUPABASE_SERVICE_ROLE_KEY) or "local" (development only:
    # files under RECEIPT_LOCAL_DIR, never for real user data).
    receipt_storage: str = "supabase"
    receipt_local_dir: str = "var/receipts"
    # "google" (default; needs GOOGLE_APPLICATION_CREDENTIALS) or "fixture" (development
    # only: returns the stored text of known synthetic receipt images in OCR_FIXTURE_DIR).
    ocr_provider: str = "google"
    ocr_fixture_dir: str = "tests/fixtures/receipts"
    # Below this mean word confidence (0–1) a scan is treated as unreadable.
    ocr_min_confidence: float = 0.5
    receipt_max_bytes: int = 10 * 1024 * 1024
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
