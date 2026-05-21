"""Centralised settings, loaded from env (see deploy/.env.example)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Locale = str  # e.g. "de", "en-US", "es", "in" — kept loose; mapped in discovery/youtube


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    # --- paths ---
    data_dir: Path = Field(default=Path("/data"), alias="SHORTS_DATA_DIR")
    tts_models_dir: Path = Field(default=Path("/models"), alias="SHORTS_TTS_MODELS_DIR")
    cache_dir: Path = Field(default=Path("/cache"), alias="SHORTS_CACHE_DIR")

    # --- database ---
    database_url: str = Field(
        default="postgresql+asyncpg://shorts:shorts@127.0.0.1:5433/shorts",
        alias="DATABASE_URL",
    )

    # --- public vhost ---
    public_base_url: str = Field(default="http://localhost:8080", alias="PUBLIC_BASE_URL")

    # --- discovery ---
    locales: list[Locale] = Field(default_factory=lambda: ["de", "en-US", "es", "in"])
    youtube_api_key: str = Field(default="", alias="YOUTUBE_API_KEY")
    apify_token: str = Field(default="", alias="APIFY_TOKEN")
    pexels_api_key: str = Field(default="", alias="PEXELS_API_KEY")
    plex_base_url: str = Field(default="", alias="PLEX_BASE_URL")
    plex_token: str = Field(default="", alias="PLEX_TOKEN")

    # --- LLM / TTS ---
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    claude_oauth_token: str = Field(default="", alias="CLAUDE_OAUTH_TOKEN")
    anthropic_oauth_beta: str = Field(
        default="oauth-2025-04-20", alias="ANTHROPIC_OAUTH_BETA"
    )
    anthropic_script_model: str = Field(
        default="claude-sonnet-4-6", alias="ANTHROPIC_SCRIPT_MODEL"
    )
    elevenlabs_api_key: str = Field(default="", alias="ELEVENLABS_API_KEY")
    whisper_base_url: str = Field(
        default="http://whisper:9000", alias="WHISPER_BASE_URL"
    )

    # --- YouTube uploader ---
    yt_client_id: str = Field(default="", alias="YT_CLIENT_ID")
    yt_client_secret: str = Field(default="", alias="YT_CLIENT_SECRET")
    yt_refresh_token: str = Field(default="", alias="YT_REFRESH_TOKEN")
    yt_upload_privacy: str = Field(default="private", alias="YT_UPLOAD_PRIVACY")
    yt_category_id: str = Field(default="24", alias="YT_CATEGORY_ID")  # Entertainment

    # --- pipeline limits (fair-use posture; do not raise without legal review) ---
    max_source_clip_seconds: float = Field(
        default=8.0, alias="MAX_SOURCE_CLIP_SECONDS"
    )
    target_duration_seconds: float = Field(
        default=40.0, alias="TARGET_DURATION_SECONDS"
    )
    max_uploads_per_day: int = Field(default=6, alias="MAX_UPLOADS_PER_DAY")
    runs_per_day: int = Field(default=4, alias="RUNS_PER_DAY")

    # --- music-content skip list ---
    title_blocklist: list[str] = Field(
        default_factory=lambda: [
            "official video", "official music video", "official mv",
            "lyrics", "lyric video", "audio only",
        ]
    )

    @field_validator("locales", mode="before")
    @classmethod
    def _parse_csv(cls, v: object) -> object:
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        return v

    @field_validator("title_blocklist", mode="before")
    @classmethod
    def _parse_blocklist(cls, v: object) -> object:
        if isinstance(v, str):
            return [x.strip().lower() for x in v.split(",") if x.strip()]
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
