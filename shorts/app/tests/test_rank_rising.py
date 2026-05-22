from datetime import UTC, datetime, timedelta

from shorts.discovery.youtube import YouTubeItem
from shorts.pipeline.rank import combined_score, rank


def _mature_hit(video_id: str = "mature") -> YouTubeItem:
    # 1M views, 24h old, no rising signal → ~42k velocity.
    return YouTubeItem(
        video_id=video_id,
        title="Mature trending hit",
        channel="c",
        view_count=1_000_000,
        published_at=datetime.now(UTC) - timedelta(hours=24),
        locale="en-US",
    )


def _rising_fresh(video_id: str = "fresh") -> YouTubeItem:
    # 100 views, 1h old, max rising signal → boost dominates.
    return YouTubeItem(
        video_id=video_id,
        title="Fresh emerging topic",
        channel="c",
        view_count=100,
        published_at=datetime.now(UTC) - timedelta(hours=1),
        locale="en-US",
        rising_score=1.0,
        rising_source="reddit",
    )


def test_combined_score_uses_max_of_signals():
    mature = _mature_hit()
    fresh = _rising_fresh()
    assert combined_score(mature) > 40_000  # raw velocity dominates here
    # Fresh has tiny velocity but max rising → boost wins.
    assert combined_score(fresh) >= 100_000


def test_rising_fresh_outranks_mature_with_no_signal():
    items = [_mature_hit(), _rising_fresh()]
    ranked = rank(items, blocklist=[])
    assert ranked[0][0].video_id == "fresh"
    assert ranked[1][0].video_id == "mature"


def test_low_rising_doesnt_boost_above_mature():
    fresh = YouTubeItem(
        video_id="fresh-low",
        title="Mildly rising",
        channel="c",
        view_count=100,
        published_at=datetime.now(UTC) - timedelta(hours=1),
        locale="en-US",
        rising_score=0.1,  # boost only ~10k — below mature's ~42k velocity.
    )
    ranked = rank([_mature_hit(), fresh], blocklist=[])
    assert ranked[0][0].video_id == "mature"
