"""APScheduler config — one job per locale, staggered across the day."""

from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from shorts.config import get_settings
from shorts.jobs.analytics_sync import run as analytics_run
from shorts.jobs.worker import _run

log = logging.getLogger("shorts.scheduler")


def build_scheduler() -> AsyncIOScheduler:
    settings = get_settings()
    sched = AsyncIOScheduler(timezone="UTC")
    # Stagger locales so we never hit the YouTube API in a thundering herd.
    hours_by_locale = _stagger(settings.locales, runs_per_day=settings.runs_per_day)
    for locale, hours in hours_by_locale.items():
        for hr in hours:
            sched.add_job(
                _run,
                CronTrigger(hour=hr, minute=_offset_minute(locale)),
                kwargs={"locale": locale, "dry_run": False, "limit": 1},
                id=f"run-{locale}-{hr:02d}",
                replace_existing=True,
                misfire_grace_time=600,
                coalesce=True,
                max_instances=1,
            )
            log.info("scheduled locale=%s at %02d:%02d UTC", locale, hr, _offset_minute(locale))
    # Daily analytics sync at 04:15 UTC (well after the last upload window).
    sched.add_job(
        analytics_run,
        CronTrigger(hour=4, minute=15),
        id="analytics-sync",
        replace_existing=True,
        misfire_grace_time=3600,
        coalesce=True,
        max_instances=1,
    )
    return sched


def _stagger(locales: list[str], *, runs_per_day: int) -> dict[str, list[int]]:
    step = max(1, 24 // max(1, runs_per_day))
    return {loc: [(i * step) % 24 for i in range(runs_per_day)] for loc in locales}


def _offset_minute(locale: str) -> int:
    return {"de": 5, "en-US": 20, "es": 35, "in": 50}.get(locale, 0)
