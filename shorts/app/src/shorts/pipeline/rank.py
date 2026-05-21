"""Combined view-velocity + rising-trends ranking + title blocklist.

A pure view-velocity rank rewards videos that have already exploded —
which by the time we see them are 6–24h old and we're late. A rising
candidate has a `rising_score` (normalised to [0,1]) attached by
`discovery/trends`; for those, we use it as a first-mover boost that
beats raw velocity for content < 12h old.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from shorts.discovery.youtube import YouTubeItem

# How much to weight the rising signal versus raw velocity. Calibrated so a
# topic-rising fresh video (rising_score=1.0, view_count=low, age=1h) ranks
# above a mature trending video (view_count=1M, age=24h, velocity≈42k/h).
RISING_VELOCITY_EQUIVALENT = 100_000.0


def view_velocity(item: YouTubeItem, *, now: datetime | None = None) -> float:
    """Views per hour since publish. Floor of 1h to avoid division blowup."""
    now = now or datetime.now(UTC)
    age_hours = max((now - item.published_at).total_seconds() / 3600.0, 1.0)
    return item.view_count / age_hours


def combined_score(item: YouTubeItem, *, now: datetime | None = None) -> float:
    """Take the max of view-velocity and rising-boost — whichever is the
    stronger signal wins. First-mover content rarely has the views yet, so
    rising_score is what carries it; mature trending content has the views
    but no rising signal, so velocity wins there."""
    vv = view_velocity(item, now=now)
    rb = item.rising_score * RISING_VELOCITY_EQUIVALENT
    return max(vv, rb)


def is_blocked(title: str, blocklist: Iterable[str]) -> bool:
    t = title.lower()
    return any(needle in t for needle in blocklist)


def rank(
    items: Iterable[YouTubeItem],
    *,
    blocklist: Iterable[str],
    now: datetime | None = None,
) -> list[tuple[YouTubeItem, float]]:
    scored = [
        (item, combined_score(item, now=now))
        for item in items
        if not is_blocked(item.title, blocklist)
    ]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored
