import os

import pytest

from shorts.config import Settings


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in list(os.environ):
        if k.startswith(("YT_", "ANTHROPIC_", "CLAUDE_", "POSTGRES_", "PEXELS_", "PLEX_")):
            monkeypatch.delenv(k, raising=False)


def test_channel_for_falls_back_to_global(monkeypatch):
    monkeypatch.setenv("YT_CLIENT_ID", "gid")
    monkeypatch.setenv("YT_CLIENT_SECRET", "gsec")
    monkeypatch.setenv("YT_REFRESH_TOKEN", "gref")
    s = Settings(_env_file=None)
    assert s.channel_for("de") == ("gid", "gsec", "gref")
    assert s.channel_for("anything") == ("gid", "gsec", "gref")


def test_channel_for_per_locale_override(monkeypatch):
    monkeypatch.setenv("YT_CLIENT_ID", "gid")
    monkeypatch.setenv("YT_CLIENT_SECRET", "gsec")
    monkeypatch.setenv("YT_REFRESH_TOKEN", "gref")
    monkeypatch.setenv(
        "YT_CHANNELS_JSON",
        '{"de": {"client_id": "did", "client_secret": "dsec", "refresh_token": "dref"}}',
    )
    s = Settings(_env_file=None)
    assert s.channel_for("de") == ("did", "dsec", "dref")
    # Locale not in the dict falls through.
    assert s.channel_for("en-US") == ("gid", "gsec", "gref")


def test_channel_for_partial_override_inherits_client_creds(monkeypatch):
    monkeypatch.setenv("YT_CLIENT_ID", "gid")
    monkeypatch.setenv("YT_CLIENT_SECRET", "gsec")
    monkeypatch.setenv("YT_REFRESH_TOKEN", "gref")
    # Only refresh_token set → re-use global client_id + secret.
    monkeypatch.setenv("YT_CHANNELS_JSON", '{"es": {"refresh_token": "esref"}}')
    s = Settings(_env_file=None)
    assert s.channel_for("es") == ("gid", "gsec", "esref")
