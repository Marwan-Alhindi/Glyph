"""Application settings — typed env vars via pydantic-settings.

All modules import from here instead of calling os.getenv() directly.
Clients (Supabase, OpenAI, JWKS) are constructed in dependencies.py, not here.
"""

import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=os.path.join(_BASE_DIR, ".env"),
        extra="ignore",
    )

    # Supabase
    supabase_url: str
    supabase_service_key: str

    # LLM providers
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    google_api_key: str = ""

    # CORS — comma-separated origins
    cors_origins: str = "http://localhost:5173"

    # Email (Resend)
    resend_api_key: str = ""
    email_from: str = "Glyph <onboarding@resend.dev>"
    app_url: str = "http://localhost:5173"

    # Google OAuth (integrations)
    google_client_id: str = ""
    google_client_secret: str = ""
    integrations_oauth_redirect_uri: str = "http://localhost:8000/integrations/oauth/callback"

    # LangSmith tracing
    langsmith_tracing: str = "false"
    langsmith_api_key: str = "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"
    langsmith_project: str = "(default)"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


@lru_cache
def get_settings() -> Settings:
    return Settings()
