from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend settings, read from apps/api/.env (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Postgres connection string (Supabase: Project Settings → Database → Connection string).
    database_url: str = ""
    db_pool_size: int = 5
    db_max_overflow: int = 5
    # Pooled connections go stale while idle (Supabase pooler idle limits, laptop sleep or
    # network changes). Retire them after this many seconds; checkout also pings them.
    db_pool_recycle_seconds: int = 300
    # Bound how long opening a connection, or noticing a dead idle one, can take.
    db_connect_timeout_seconds: int = 10
    db_keepalive_idle_seconds: int = 30

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

    # Purchase-pattern data tiers (AGENTS.md §7.3; approved 2026-11-12, configurable).
    # Fewer purchase days than `limited` → insufficient; fewer than `sufficient` → limited.
    pattern_min_purchases_limited: int = 3
    pattern_min_purchases_sufficient: int = 5

    # Replenishment (AGENTS.md §7.4; decisions approved 2026-11-13). Only sufficient-tier
    # patterns with confidence >= the minimum get suggestions; a suggestion is due when its
    # date is within the approach window. "I still have some" pushes the date by
    # max(still_have_min_days, round(average interval / 2)).
    replenishment_min_confidence: float = 0.6
    replenishment_window_days: int = 3
    still_have_min_days: int = 3

    # Pantry and meals (AGENTS.md §7.5; decisions approved 2026-11-13).
    pantry_expiring_days: int = 3  # "use soon" when the user-set expiry is this close
    meal_idea_min_match_pct: int = 80  # daily meal idea only for a recipe this well matched
    recommendations_limit: int = 10

    # AI insights (AGENTS.md §7.7). Without OPENAI_API_KEY the same figures are written by a
    # fixed template (labelled "summary", never "AI").
    insights_min_transactions: int = 5  # in the current + previous month
    openai_timeout_seconds: float = 20.0

    # Scheduled jobs (AGENTS.md §7.6) run inside the API process. Off unless enabled, so
    # tests and one-off scripts never start background threads.
    scheduler_enabled: bool = False
    daily_job_hour: int = 6  # Asia/Manila (settings.tz)
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
