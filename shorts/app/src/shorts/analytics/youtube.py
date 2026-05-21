"""YouTube Analytics API client.

Pulls per-video metrics (views, avg view duration %, likes, comments,
subscribers gained, est. revenue) for the past N days and upserts them
into the `performance` table.

Requires an OAuth refresh token granted with the
`yt-analytics.readonly` and `yt-analytics-monetary.readonly` scopes — in
addition to the upload scope. Re-run the OAuth dance from docs/runbook.md
with `--scope yt-analytics` to mint a new refresh token.

If YT_ANALYTICS_ENABLED is false, this whole module is a no-op.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from shorts.config import Settings

log = logging.getLogger("shorts.analytics")

SCOPES = [
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
]
TOKEN_URI = "https://oauth2.googleapis.com/token"

METRICS = (
    "views,averageViewDuration,averageViewPercentage,"
    "likes,comments,shares,subscribersGained,estimatedRevenue"
)


@dataclass(slots=True)
class DayMetrics:
    video_id: str
    day: str
    views: int
    avg_view_duration_s: float
    avg_view_pct: float
    likes: int
    comments: int
    shares: int
    subscribers_gained: int
    estimated_revenue_usd: float


class YouTubeAnalytics:
    def __init__(self, settings: Settings, *, locale: str = "en-US") -> None:
        client_id, client_secret, refresh_token = settings.channel_for(locale)
        if not (client_id and client_secret and refresh_token):
            raise RuntimeError(f"no OAuth creds configured for locale={locale}")
        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri=TOKEN_URI,
            client_id=client_id,
            client_secret=client_secret,
            scopes=SCOPES,
        )
        creds.refresh(Request())
        self.service = build("youtubeAnalytics", "v2", credentials=creds, cache_discovery=False)

    def fetch_by_day(
        self, *, video_ids: list[str], start: date, end: date | None = None
    ) -> list[DayMetrics]:
        """Return per-(video, day) rows. Hidden monetary metrics are zero-filled
        if the scope or YPP isn't granted yet."""
        end = end or datetime.now(UTC).date()
        if not video_ids:
            return []
        out: list[DayMetrics] = []
        for vid in video_ids:
            try:
                resp = self.service.reports().query(
                    ids="channel==MINE",
                    startDate=start.isoformat(),
                    endDate=end.isoformat(),
                    metrics=METRICS,
                    dimensions="day",
                    filters=f"video=={vid}",
                ).execute()
            except Exception:  # YT Analytics is brittle; one bad video shouldn't tank a batch
                log.exception("analytics query failed for video=%s", vid)
                continue
            for row in resp.get("rows", []):
                day, views, avd, avp, likes, comments, shares, subs, rev = _pad(row, 9)
                out.append(
                    DayMetrics(
                        video_id=vid,
                        day=str(day),
                        views=int(views or 0),
                        avg_view_duration_s=float(avd or 0),
                        avg_view_pct=float(avp or 0),
                        likes=int(likes or 0),
                        comments=int(comments or 0),
                        shares=int(shares or 0),
                        subscribers_gained=int(subs or 0),
                        estimated_revenue_usd=float(rev or 0),
                    )
                )
        return out


def _pad(row: list, n: int) -> list:
    return list(row) + [None] * max(0, n - len(row))


def window_start(days: int) -> date:
    return (datetime.now(UTC) - timedelta(days=days)).date()
