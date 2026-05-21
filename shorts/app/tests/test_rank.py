from datetime import UTC, datetime, timedelta

from shorts.discovery.youtube import YouTubeItem
from shorts.pipeline.rank import is_blocked, rank, view_velocity


def _item(*, vid: str, views: int, age_h: float, title: str = "x") -> YouTubeItem:
    return YouTubeItem(
        video_id=vid,
        title=title,
        channel="c",
        view_count=views,
        published_at=datetime.now(UTC) - timedelta(hours=age_h),
        locale="en-US",
    )


def test_velocity_is_views_per_hour():
    item = _item(vid="a", views=600, age_h=2)
    assert abs(view_velocity(item) - 300.0) < 1.0


def test_velocity_floors_age_to_one_hour():
    item = _item(vid="fresh", views=100, age_h=0.1)
    assert abs(view_velocity(item) - 100.0) < 0.5


def test_blocklist_drops_matching_titles():
    assert is_blocked("ARTIST - Song (Official Music Video)", ["official music video"])
    assert not is_blocked("My take on the news", ["official music video"])


def test_rank_sorts_by_velocity_and_filters_blocked():
    items = [
        _item(vid="slow", views=100, age_h=10),
        _item(vid="fast", views=10_000, age_h=1),
        _item(vid="music", views=10_000_000, age_h=1, title="Foo (Official Music Video)"),
    ]
    ranked = rank(items, blocklist=["official music video"])
    assert [it.video_id for it, _ in ranked] == ["fast", "slow"]
