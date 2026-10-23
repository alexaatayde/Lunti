from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend settings, read from apps/api/.env (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = ""
    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    supabase_service_role_key: str = ""
    google_application_credentials: str = ""
    openai_api_key: str = ""
    openai_model: str = ""
    fcm_credentials: str = ""
    tz: str = "Asia/Manila"


settings = Settings()
