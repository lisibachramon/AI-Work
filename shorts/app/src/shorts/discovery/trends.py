"""Rising-trend discovery: Reddit /r/popular/rising + Google Trends daily RSS.

We use these as a *second* signal source on top of YouTube `mostPopular`.
The advantage is timing — Reddit and Google Trends often surface topics
hours before they hit YouTube's trending list, which is where the
algorithm's first-mover bonus lives. Catching a topic an hour early can
2–5× pickup on a Short.

Both endpoints are public and don't require auth, though Reddit asks
for a descriptive User-Agent.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from xml.etree import ElementTree as ET

import httpx

from shorts.discovery.youtube import YouTubeDiscovery, YouTubeItem

log = logging.getLogger("shorts.trends")

REDDIT_UA = "shorts-pipeline/0.1 (+https://shorts.lisibach.xyz)"


@dataclass(slots=True)
class RisingTopic:
    text: str          # the topic / search query
    source: str        # "reddit" | "google_trends"
    velocity: float    # signal strength, scaled to be comparable across sources
    locale: str
    extra: dict


# Map our locales to subreddit hubs (Reddit doesn't expose per-country trending
# universally — these are well-trafficked country hubs). The blank entry means
# fall back to /r/popular.
LOCALE_TO_SUBREDDIT = {
    "de": "de",
    "en-US": "popular",  # global default
    "es": "es",
    "in": "india",
}

LOCALE_TO_GTRENDS_GEO = {"de": "DE", "en-US": "US", "es": "ES", "in": "IN"}


class TrendsDiscovery:
    """Pulls topic-level signals from Reddit + Google Trends RSS."""

    REDDIT_BASE = "https://www.reddit.com"
    GTRENDS_BASE = "https://trends.google.com/trends/trendingsearches/daily/rss"

    def __init__(self, *, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(
            timeout=20.0, headers={"User-Agent": REDDIT_UA}
        )

    async def from_reddit(self, locale: str, *, limit: int = 25) -> list[RisingTopic]:
        sub = LOCALE_TO_SUBREDDIT.get(locale, "popular")
        url = f"{self.REDDIT_BASE}/r/{sub}/rising.json"
        try:
            r = await self._client.get(url, params={"limit": limit})
            r.raise_for_status()
        except Exception:  # Reddit rate-limits sometimes; treat as zero signal
            log.exception("reddit rising fetch failed for sub=%s", sub)
            return []
        out: list[RisingTopic] = []
        for child in r.json().get("data", {}).get("children", []):
            d = child.get("data", {})
            created = datetime.fromtimestamp(d.get("created_utc", 0), tz=UTC)
            age_h = max((datetime.now(UTC) - created).total_seconds() / 3600.0, 0.5)
            score = float(d.get("score", 0)) / age_h
            title = _clean_topic(d.get("title", ""))
            if not title:
                continue
            out.append(
                RisingTopic(
                    text=title,
                    source="reddit",
                    velocity=score,
                    locale=locale,
                    extra={
                        "subreddit": d.get("subreddit"),
                        "url": d.get("url"),
                        "permalink": f"{self.REDDIT_BASE}{d.get('permalink', '')}",
                        "age_hours": age_h,
                    },
                )
            )
        return out

    async def from_google_trends(self, locale: str) -> list[RisingTopic]:
        geo = LOCALE_TO_GTRENDS_GEO.get(locale, "US")
        try:
            r = await self._client.get(self.GTRENDS_BASE, params={"geo": geo})
            r.raise_for_status()
        except Exception:
            log.exception("google trends fetch failed for geo=%s", geo)
            return []
        out: list[RisingTopic] = []
        try:
            root = ET.fromstring(r.text)
        except ET.ParseError:
            log.exception("google trends RSS parse failed")
            return []
        # Items are ordered roughly by traffic. We score by rank desc.
        items = root.findall(".//item")
        for idx, item in enumerate(items):
            title_el = item.find("title")
            if title_el is None or not title_el.text:
                continue
            text = _clean_topic(title_el.text)
            if not text:
                continue
            # Newest at top → highest synthetic velocity.
            velocity = max(1.0, (len(items) - idx) * 10.0)
            traffic_el = item.find(".//{*}approx_traffic")
            traffic = (traffic_el.text or "").strip() if traffic_el is not None else ""
            out.append(
                RisingTopic(
                    text=text,
                    source="google_trends",
                    velocity=velocity,
                    locale=locale,
                    extra={"approx_traffic": traffic, "rank": idx + 1},
                )
            )
        return out

    async def topics(self, locale: str, *, max_results: int = 12) -> list[RisingTopic]:
        """Merged + de-duped topic list, highest velocity first."""
        reddit, gtrends = [], []
        try:
            reddit = await self.from_reddit(locale)
        except Exception:
            log.exception("reddit topics failed")
        try:
            gtrends = await self.from_google_trends(locale)
        except Exception:
            log.exception("gtrends topics failed")

        # Normalise across sources: scale each source to its own max=1.0 so
        # they're comparable before summing. (Reddit scores are already
        # per-hour, gtrends are synthetic ranks.)
        def _normalise(items: list[RisingTopic]) -> list[RisingTopic]:
            if not items:
                return items
            top = max(i.velocity for i in items) or 1.0
            return [
                RisingTopic(
                    text=i.text, source=i.source, velocity=i.velocity / top,
                    locale=i.locale, extra=i.extra
                ) for i in items
            ]

        merged: dict[str, RisingTopic] = {}
        for item in _normalise(reddit) + _normalise(gtrends):
            key = _topic_key(item.text)
            existing = merged.get(key)
            if existing is None or item.velocity > existing.velocity:
                merged[key] = item
        ranked = sorted(merged.values(), key=lambda t: t.velocity, reverse=True)
        return ranked[:max_results]

    async def to_youtube_candidates(
        self,
        topics: list[RisingTopic],
        *,
        yt: YouTubeDiscovery,
        max_per_topic: int = 1,
        window_hours: int = 24,
    ) -> list[YouTubeItem]:
        """Resolve topics into recent YouTube videos by query, attaching the
        topic's velocity as `rising_score` so downstream ranking can use it."""
        published_after = datetime.now(UTC) - timedelta(hours=window_hours)
        out: list[YouTubeItem] = []
        for topic in topics:
            try:
                hits = await yt.search_recent(
                    topic.text,
                    locale=topic.locale,
                    published_after=published_after,
                    max_results=max_per_topic,
                )
            except Exception:
                log.exception("search_recent failed for topic=%r", topic.text)
                continue
            for h in hits:
                # The same dataclass instance can't be mutated (frozen=False but slots),
                # so construct a new one with rising metadata attached.
                out.append(
                    YouTubeItem(
                        video_id=h.video_id,
                        title=h.title,
                        channel=h.channel,
                        view_count=h.view_count,
                        published_at=h.published_at,
                        locale=h.locale,
                        rising_score=topic.velocity,
                        rising_source=topic.source,
                    )
                )
        return out

    async def aclose(self) -> None:
        await self._client.aclose()


_BRACKETS = re.compile(r"\[[^\]]*\]|\([^)]*\)")
_NSFW = re.compile(r"\b(nsfw|porn|onlyfans)\b", re.IGNORECASE)


def _clean_topic(text: str) -> str:
    """Strip Reddit-style flair tags and obvious noise."""
    if _NSFW.search(text):
        return ""
    text = _BRACKETS.sub("", text).strip()
    text = re.sub(r"\s+", " ", text)
    if _NSFW.search(text):
        return ""
    return text[:200]


def _topic_key(text: str) -> str:
    """De-dupe key — lowercased alphanumerics only."""
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()
