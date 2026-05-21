"""View-velocity ranking + title blocklist."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from shorts.discovery.youtube import YouTubeItem


def view_velocity(item: YouTubeItem, *, now: datetime | None = None) -> float:
    """Views per hour since publish. Floor of 1h to avoid division blowup."""
    now = now or datetime.now(UTC)
    age_hours = max((now - item.published_at).total_seconds() / 3600.0, 1.0)
    return item.view_count / age_hours


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
        (item, view_velocity(item, now=now))
        for item in items
        if not is_blocked(item.title, blocklist)
    ]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored
