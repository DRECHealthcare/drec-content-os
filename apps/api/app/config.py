from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    environment: str = "local"
    database_url: Optional[str] = None
    supabase_url: Optional[str] = None
    supabase_service_role_key: Optional[str] = None
    supabase_api_key: Optional[str] = None
    meta_graph_version: str = "v23.0"
    meta_page_id: Optional[str] = None
    meta_ig_user_id: Optional[str] = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
