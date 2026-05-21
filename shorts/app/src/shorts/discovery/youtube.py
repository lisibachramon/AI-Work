"""YouTube Data API v3 discovery.

videos.list?chart=mostPopular&regionCode=... is the cheapest call (1 quota
unit) and gives us trending per region. We bundle a couple of metadata
fields and let downstream code rank by view velocity.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

import httpx

# Maps our short locale codes to the YouTube regionCode + an interface language.
LOCALE_TO_REGION: dict[str, tuple[str, str]] = {
    "de": ("DE", "de"),
    "en-US": ("US", "en"),
    "es": ("ES", "es"),
    "in": ("IN", "hi"),
}


@dataclass(slots=True)
class YouTubeItem:
    video_id: str
    title: str
    channel: str
    view_count: int
    published_at: datetime
    locale: str

    @property
    def url(self) -> str:
        return f"https://www.youtube.com/watch?v={self.video_id}"


class YouTubeDiscovery:
    BASE_URL = "https://www.googleapis.com/youtube/v3"

    def __init__(self, api_key: str, *, client: httpx.AsyncClient | None = None) -> None:
        if not api_key:
            raise ValueError("YOUTUBE_API_KEY is empty")
        self.api_key = api_key
        self._client = client or httpx.AsyncClient(timeout=20.0)

    async def trending(self, locale: str, *, max_results: int = 20) -> list[YouTubeItem]:
        region, _hl = LOCALE_TO_REGION.get(locale, ("US", "en"))
        params = {
            "part": "snippet,statistics",
            "chart": "mostPopular",
            "regionCode": region,
            "maxResults": max_results,
            "videoCategoryId": "0",
            "key": self.api_key,
        }
        r = await self._client.get(f"{self.BASE_URL}/videos", params=params)
        r.raise_for_status()
        out: list[YouTubeItem] = []
        for item in r.json().get("items", []):
            snippet = item["snippet"]
            stats = item.get("statistics", {})
            out.append(
                YouTubeItem(
                    video_id=item["id"],
                    title=snippet["title"],
                    channel=snippet["channelTitle"],
                    view_count=int(stats.get("viewCount", 0)),
                    published_at=_parse_iso8601(snippet["publishedAt"]),
                    locale=locale,
                )
            )
        return out

    async def aclose(self) -> None:
        await self._client.aclose()


def _parse_iso8601(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(UTC)
