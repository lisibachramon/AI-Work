"""Daily scan: find Shorts that crossed the long-form trigger and queue a
companion render.

Why this exists: the long-form RPM on YouTube is 10–50× the Shorts RPM, so
the single highest-leverage automation is "when one of our Shorts pops,
go deeper on the same topic with a 5–10 minute essay." This job is the
trigger.

A Short qualifies if:
- It is a `Published(kind='short')` row.
- Sum of `Performance.views` over the last LONGFORM_TRIGGER_DAYS days is
  ≥ LONGFORM_TRIGGER_VIEWS.
- No `Published(kind='longform', candidate_id=cand_id)` already exists.

The dispatcher only marks rows as queued (returning candidate_ids); the
worker handles the actual render asynchronously to avoid blocking the
scheduler loop on a multi-minute job.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shorts.config import get_settings
from shorts.db.models import Performance, Published, get_sessionmaker

log = logging.getLogger("shorts.longform_dispatcher")


@dataclass(slots=True)
class LongformJob:
    parent_published_id: int
    candidate_id: int
    locale: str
    total_views: int


async def find_qualifying_shorts(session: AsyncSession) -> list[LongformJob]:
    settings = get_settings()
    if not settings.longform_enabled:
        return []
    cutoff = (datetime.now(UTC) - timedelta(days=settings.longform_trigger_days)).date().isoformat()
    views_sum = func.sum(Performance.views).label("views")

    # Inner select: for each (Published.kind=short, locale, candidate), aggregate
    # views inside the trigger window. Outer select then excludes anything that
    # already has a longform sibling.
    has_longform = (
        select(Published.candidate_id)
        .where(Published.kind == "longform")
        .subquery()
    )

    q = (
        select(
            Published.id,
            Published.candidate_id,
            Published.locale,
            views_sum,
        )
        .join(Performance, Performance.youtube_video_id == Published.youtube_video_id)
        .where(
            and_(
                Published.kind == "short",
                Published.candidate_id.notin_(select(has_longform.c.candidate_id)),
                Performance.day >= cutoff,
            )
        )
        .group_by(Published.id, Published.candidate_id, Published.locale)
        .having(views_sum >= settings.longform_trigger_views)
        .order_by(views_sum.desc())
        .limit(settings.max_longform_per_day)
    )
    rows = (await session.execute(q)).all()
    return [
        LongformJob(
            parent_published_id=int(r[0]),
            candidate_id=int(r[1]),
            locale=str(r[2]),
            total_views=int(r[3] or 0),
        )
        for r in rows
    ]


async def run() -> list[LongformJob]:
    """Returns the list of queued jobs (caller is responsible for kicking the worker)."""
    Session = get_sessionmaker()
    async with Session() as session:
        jobs = await find_qualifying_shorts(session)
    for j in jobs:
        log.info(
            "queueing longform for candidate_id=%s locale=%s parent_views=%s",
            j.candidate_id, j.locale, j.total_views,
        )
    return jobs
