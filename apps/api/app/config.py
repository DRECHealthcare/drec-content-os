from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    environment: str = "local"
    database_url: Optional[str] = None
    supabase_url: Optional[str] = None
    supabase_service_role_key: Optional[str] = None
    supabase_api_key: Optional[str] = None
    drec_access_token: Optional[str] = None
    drec_viewer_token: Optional[str] = None
    drec_reviewer_token: Optional[str] = None
    drec_operator_token: Optional[str] = None
    drec_admin_token: Optional[str] = None
    meta_graph_version: str = "v23.0"
    meta_app_id: Optional[str] = None
    meta_app_secret: Optional[str] = None
    meta_oauth_redirect_uri: str = "https://drec-content-os.vercel.app/"
    meta_page_id: Optional[str] = None
    meta_ig_user_id: Optional[str] = None
    meta_page_access_token: Optional[str] = None
    meta_enable_publishing: bool = False
    meta_enable_publishing_job: bool = False
    meta_enable_metrics_job: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
