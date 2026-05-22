"""Centralised settings, loaded from env (see deploy/.env.example)."""

from __future__ import annotations

import json
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
    assets_dir: Path = Field(default=Path("/assets"), alias="SHORTS_ASSETS_DIR")

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

    # --- TTS voice cloning (optional; consistent host voice → channel identity → subs) ---
    # 6–10s clean .wav sample of the host. Used by XTTS speaker_wav. If empty,
    # falls back to the built-in "Daisy Studious" voice.
    host_voice_sample_path: str = Field(default="", alias="HOST_VOICE_SAMPLE_PATH")

    # --- YouTube uploader (single-channel default; multi-channel overrides below) ---
    yt_client_id: str = Field(default="", alias="YT_CLIENT_ID")
    yt_client_secret: str = Field(default="", alias="YT_CLIENT_SECRET")
    yt_refresh_token: str = Field(default="", alias="YT_REFRESH_TOKEN")
    yt_upload_privacy: str = Field(default="private", alias="YT_UPLOAD_PRIVACY")
    yt_category_id: str = Field(default="24", alias="YT_CATEGORY_ID")  # Entertainment

    # --- Multi-channel routing: niche channels monetise far better than generalists.
    # JSON dict: {"de": {"client_id":"...", "client_secret":"...", "refresh_token":"..."}, ...}
    # If a locale isn't in this dict, falls back to the global YT_* above.
    yt_channels: dict = Field(default_factory=dict, alias="YT_CHANNELS_JSON")

    # --- Variants + A/B (higher CTR + retention → more impressions) ---
    title_variants: int = Field(default=3, alias="TITLE_VARIANTS")
    hook_variants: int = Field(default=3, alias="HOOK_VARIANTS")

    # --- Thumbnails (custom > auto on Shorts shelves) ---
    channel_name: str = Field(default="", alias="CHANNEL_NAME")
    thumbnail_font_path: str = Field(
        default="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        alias="THUMBNAIL_FONT_PATH",
    )
    upload_custom_thumbnail: bool = Field(default=True, alias="UPLOAD_CUSTOM_THUMBNAIL")

    # --- Analytics feedback loop ---
    yt_analytics_enabled: bool = Field(default=False, alias="YT_ANALYTICS_ENABLED")
    yt_winner_lookback_days: int = Field(default=30, alias="YT_WINNER_LOOKBACK_DAYS")
    yt_winner_min_views: int = Field(default=5000, alias="YT_WINNER_MIN_VIEWS")

    # --- Pinned-comment / list-building CTA ---
    cta_comment_template: str = Field(default="", alias="CTA_COMMENT_TEMPLATE")
    post_pinned_comment: bool = Field(default=False, alias="POST_PINNED_COMMENT")

    # --- Affiliate revenue layer ---
    affiliates_yaml_path: str = Field(default="", alias="AFFILIATES_YAML_PATH")
    link_redirect_domain: str = Field(default="", alias="LINK_REDIRECT_DOMAIN")
    amazon_tag: str = Field(default="", alias="AMAZON_TAG")

    # --- Distribution / multi-aspect renders ---
    # Aspect ratios to render in addition to 9:16. 1x1 for Insta feed, 16:9 for X/YT-long.
    render_aspects: list[str] = Field(
        default_factory=lambda: ["9x16", "1x1", "16x9"], alias="RENDER_ASPECTS"
    )

    # --- Rising-trend discovery (first-mover advantage) ---
    rising_trends_enabled: bool = Field(default=True, alias="RISING_TRENDS_ENABLED")
    rising_topics_per_locale: int = Field(default=8, alias="RISING_TOPICS_PER_LOCALE")
    rising_window_hours: int = Field(default=24, alias="RISING_WINDOW_HOURS")

    # --- Long-form companion (10–50× per-video revenue when a Short pops) ---
    longform_enabled: bool = Field(default=False, alias="LONGFORM_ENABLED")
    # A Short crossing this view total within LONGFORM_TRIGGER_DAYS auto-spawns
    # a long-form companion. 25k is a reasonable default for a new channel.
    longform_trigger_views: int = Field(default=25_000, alias="LONGFORM_TRIGGER_VIEWS")
    longform_trigger_days: int = Field(default=3, alias="LONGFORM_TRIGGER_DAYS")
    longform_upload_privacy: str = Field(default="private", alias="LONGFORM_UPLOAD_PRIVACY")
    # YouTube category for long-form — "Entertainment" by default, "News & Politics" is 25.
    longform_category_id: str = Field(default="24", alias="LONGFORM_CATEGORY_ID")
    # Cap the dispatcher so we don't blow daily YouTube upload quota on long-forms.
    max_longform_per_day: int = Field(default=2, alias="MAX_LONGFORM_PER_DAY")

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

    @field_validator("locales", "render_aspects", mode="before")
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

    @field_validator("yt_channels", mode="before")
    @classmethod
    def _parse_channels(cls, v: object) -> object:
        if isinstance(v, str):
            v = v.strip()
            return json.loads(v) if v else {}
        return v

    def channel_for(self, locale: str) -> tuple[str, str, str]:
        """Return (client_id, client_secret, refresh_token) for a locale.
        Falls back to the global YT_* values when the locale has no override."""
        override = self.yt_channels.get(locale) if self.yt_channels else None
        if isinstance(override, dict) and override.get("refresh_token"):
            return (
                override.get("client_id") or self.yt_client_id,
                override.get("client_secret") or self.yt_client_secret,
                override["refresh_token"],
            )
        return (self.yt_client_id, self.yt_client_secret, self.yt_refresh_token)


@lru_cache
def get_settings() -> Settings:
    return Settings()
