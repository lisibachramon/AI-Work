"""Daily sync of YouTube Analytics into the `performance` table.

The script writer's feedback loop reads from `performance` to inject
recent winners as few-shot examples, so this job is what makes the
pipeline learn.

Idempotent: upserts on (youtube_video_id, day).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from shorts.analytics.youtube import YouTubeAnalytics, window_start
from shorts.config import get_settings
from shorts.db.models import Performance, Published, get_sessionmaker

log = logging.getLogger("shorts.analytics_sync")


async def run() -> int:
    """Sync recent metrics for every published video. Returns rows upserted."""
    settings = get_settings()
    if not settings.yt_analytics_enabled:
        log.info("analytics sync disabled; set YT_ANALYTICS_ENABLED=true to opt in")
        return 0

    Session = get_sessionmaker()
    upserted = 0
    async with Session() as session:
        # Group published videos by locale (each locale may map to a different channel).
        rows = (
            await session.execute(
                select(Published.locale, Published.youtube_video_id).where(
                    Published.youtube_video_id.is_not(None)
                )
            )
        ).all()

    by_locale: dict[str, list[str]] = {}
    for locale, vid in rows:
        if vid:
            by_locale.setdefault(locale, []).append(vid)

    start = window_start(settings.yt_winner_lookback_days)
    for locale, vids in by_locale.items():
        try:
            client = YouTubeAnalytics(settings, locale=locale)
        except Exception:
            log.exception("analytics client init failed for locale=%s", locale)
            continue
        try:
            metrics = client.fetch_by_day(video_ids=vids, start=start)
        except Exception:
            log.exception("analytics fetch failed for locale=%s", locale)
            continue
        async with Session() as session:
            for m in metrics:
                stmt = pg_insert(Performance).values(
                    youtube_video_id=m.video_id,
                    day=m.day,
                    views=m.views,
                    avg_view_duration_s=m.avg_view_duration_s,
                    avg_view_pct=m.avg_view_pct,
                    likes=m.likes,
                    comments=m.comments,
                    shares=m.shares,
                    subscribers_gained=m.subscribers_gained,
                    estimated_revenue_usd=m.estimated_revenue_usd,
                    updated_at=datetime.now(UTC),
                )
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_perf_video_day",
                    set_={
                        "views": stmt.excluded.views,
                        "avg_view_duration_s": stmt.excluded.avg_view_duration_s,
                        "avg_view_pct": stmt.excluded.avg_view_pct,
                        "likes": stmt.excluded.likes,
                        "comments": stmt.excluded.comments,
                        "shares": stmt.excluded.shares,
                        "subscribers_gained": stmt.excluded.subscribers_gained,
                        "estimated_revenue_usd": stmt.excluded.estimated_revenue_usd,
                        "updated_at": stmt.excluded.updated_at,
                    },
                )
                await session.execute(stmt)
                upserted += 1
            await session.commit()
    log.info("analytics sync upserted %d rows across %d locales", upserted, len(by_locale))
    return upserted
