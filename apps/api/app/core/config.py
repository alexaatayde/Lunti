from functools import cached_property

from pydantic import Field, model_validator
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
    # Receipt cleanup (app/jobs/receipt_cleanup.py), provisional values approved 2026-11-13.
    # Photos no receipt references are deleted after this long (protects uploads in flight).
    receipt_orphan_grace_hours: int = Field(default=24, ge=1)
    # Receipts never confirmed (processing, draft, failed) are deleted after this many days.
    receipt_draft_retention_days: int = Field(default=7, ge=1)
    # Hour (Asia/Manila) for the daily receipt cleanup when the scheduler is on.
    receipt_cleanup_hour: int = Field(default=3, ge=0, le=23)
    # "google" (Google Cloud Vision, billed), "fixture" (development only: returns the
    # stored text of known synthetic receipt images in OCR_FIXTURE_DIR) or "disabled".
    # Empty = "google" when APP_ENV=production, otherwise "disabled": a development API
    # never calls the paid service unless OCR_PROVIDER=google is set explicitly.
    ocr_provider: str = ""
    ocr_fixture_dir: str = "tests/fixtures/receipts"
    # How the Vision client authenticates: "service_account_file" (the JSON key named by
    # GOOGLE_APPLICATION_CREDENTIALS, kept outside the repository, mode 600) or
    # "application_default" (keyless: the runtime's attached service account / workload
    # identity; preferred for deployed infrastructure).
    google_vision_auth: str = "service_account_file"
    # Below this mean word confidence (0–1) a scan is treated as unreadable.
    ocr_min_confidence: float = 0.5
    # One Vision request, no automatic retries (each retry could be billed).
    ocr_timeout_seconds: float = Field(default=25.0, gt=0, le=120)
    # How long an upload may hold a `processing` receipt before a retry can take it over
    # (after a crash). Must cover the OCR timeout plus storage and database time.
    ocr_lease_seconds: int = Field(default=60, ge=10, le=900)
    # A duplicate upload of a receipt that is still being read waits this long for the
    # result, then gets 503 + Retry-After.
    ocr_wait_seconds: float = Field(default=20.0, ge=0, le=120)
    ocr_poll_seconds: float = Field(default=0.5, gt=0, le=10)
    # Daily OCR limits (Asia/Manila days; receipts/quota.py), kept in the database. Per user:
    # OCR runs of any engine. App-wide: requests to the billed OCR service (0 = none).
    ocr_user_daily_limit: int = Field(default=50, ge=0)
    ocr_global_daily_limit: int = Field(default=50, ge=0)
    # Recognised text of confirmed receipts is removed this many days after confirmation by
    # the receipt cleanup (the transaction and its items stay). 0 = keep (no purge). Approved
    # policy (2026-11-15): 30, set only after migration 0006 is live and a dry run is reviewed.
    receipt_raw_text_retention_days: int = Field(default=0, ge=0)
    # `processing` receipts whose upload died (lease expired) are deleted, with their photo,
    # after this many minutes without progress.
    receipt_processing_abandon_minutes: int = Field(default=60, ge=5)
    # Per-user OCR counters are only needed for today's limit; older rows are deleted.
    ocr_usage_user_retention_days: int = Field(default=31, ge=1)
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

    # Per-user rate limits (Phase 8B; app/core/rate_limit.py). "N/unit" windows separated by
    # commas (units: second, minute, hour, day); empty = no limit for that endpoint. Counts are
    # kept per API process.
    rate_limit_enabled: bool = True
    # Burst limit only: the daily scan limit is OCR_USER_DAILY_LIMIT, kept in the database so
    # it survives restarts and isn't used up by retries that never reach OCR.
    rate_limit_receipt_upload: str = "10/minute"
    rate_limit_receipt_confirm: str = "30/minute"
    rate_limit_transaction_create: str = "30/minute,500/day"

    # Request bodies larger than this are refused with 413 before they are read in full.
    # Receipt uploads may be RECEIPT_MAX_BYTES plus this much (form fields, multipart framing).
    request_max_bytes: int = Field(default=1024 * 1024, ge=1024)

    # Logging (Phase 8B; app/core/logging.py). LOG_FORMAT "json" or "text"; empty = json in
    # production, text otherwise. SQL parameter values (amounts, notes, names) stay out of
    # error messages unless LOG_SQL_PARAMETERS=true — keep it off with real data, which local
    # development against Supabase also uses.
    log_level: str = "INFO"
    log_format: str = ""
    log_sql_parameters: bool = False

    @cached_property
    def supabase_issuer(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @cached_property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_issuer}/.well-known/jwks.json"

    @property
    def is_production(self) -> bool:
        return self.app_env.strip().lower() == "production"

    @property
    def resolved_ocr_provider(self) -> str:
        provider = self.ocr_provider.strip().lower()
        if provider:
            return provider
        return "google" if self.is_production else "disabled"

    @model_validator(mode="after")
    def _lease_covers_ocr(self) -> "Settings":
        if self.ocr_lease_seconds < self.ocr_timeout_seconds + 10:
            raise ValueError("OCR_LEASE_SECONDS must be at least OCR_TIMEOUT_SECONDS + 10")
        return self

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
