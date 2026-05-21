"""TikTok trending discovery via the Apify clockworks/tiktok-scraper actor.

We use this for *signal* — what's trending on TikTok this hour — not to
redistribute. The pipeline never re-uploads TikTok content; matches found
here just hint at topics worth commenting on. If APIFY_TOKEN is empty
the discoverer returns an empty list (no-op).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

import httpx


@dataclass(slots=True)
class TikTokItem:
    video_id: str
    description: str
    author: str
    play_count: int
    created_at: datetime
    locale: str
    url: str


class TikTokDiscovery:
    BASE_URL = "https://api.apify.com/v2"
    ACTOR = "clockworks~tiktok-scraper"

    def __init__(self, token: str, *, client: httpx.AsyncClient | None = None) -> None:
        self.token = token
        self._client = client or httpx.AsyncClient(timeout=120.0)

    async def trending(self, locale: str, *, max_results: int = 20) -> list[TikTokItem]:
        if not self.token:
            return []
        params = {"token": self.token, "memory": 1024}
        body = {
            "excludePinnedPosts": True,
            "shouldDownloadCovers": False,
            "shouldDownloadVideos": False,
            "resultsPerPage": max_results,
            "scrapeType": "TRENDS",
            "region": _locale_to_region(locale),
        }
        r = await self._client.post(
            f"{self.BASE_URL}/acts/{self.ACTOR}/run-sync-get-dataset-items",
            params=params,
            json=body,
        )
        r.raise_for_status()
        out: list[TikTokItem] = []
        for item in r.json():
            out.append(
                TikTokItem(
                    video_id=str(item.get("id") or item.get("videoId") or ""),
                    description=item.get("text", "")[:512],
                    author=item.get("authorMeta", {}).get("name", ""),
                    play_count=int(item.get("playCount", 0)),
                    created_at=_safe_dt(item.get("createTimeISO")),
                    locale=locale,
                    url=item.get("webVideoUrl", ""),
                )
            )
        return [x for x in out if x.video_id]

    async def aclose(self) -> None:
        await self._client.aclose()


def _locale_to_region(locale: str) -> str:
    return {"de": "DE", "en-US": "US", "es": "ES", "in": "IN"}.get(locale, "US")


def _safe_dt(v: str | None) -> datetime:
    if not v:
        return datetime.now(UTC)
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return datetime.now(UTC)
