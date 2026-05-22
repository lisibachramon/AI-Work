from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx

from shorts.discovery.trends import TrendsDiscovery, _clean_topic, _topic_key
from shorts.discovery.youtube import YouTubeDiscovery


def test_clean_topic_strips_brackets_and_drops_nsfw():
    assert _clean_topic("[OC] Cool thing happened (mod approved)") == "Cool thing happened"
    assert _clean_topic("Some NSFW story") == ""
    assert _clean_topic("Normal title") == "Normal title"


def test_topic_key_dedupes_case_and_punctuation():
    assert _topic_key("Hello, World!") == _topic_key("hello world")
    assert _topic_key("USA Election 2026") == _topic_key("usa election 2026")


@pytest.mark.asyncio
@respx.mock
async def test_from_reddit_parses_score_and_age():
    now = datetime.now(UTC)
    fresh = (now - timedelta(hours=2)).timestamp()  # 2h old
    respx.get("https://www.reddit.com/r/popular/rising.json").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "children": [
                        {
                            "data": {
                                "title": "Big news everyone is talking about",
                                "score": 8000,
                                "created_utc": fresh,
                                "subreddit": "news",
                                "url": "https://example.com",
                                "permalink": "/r/news/comments/abc/",
                            }
                        },
                        {
                            "data": {
                                "title": "[NSFW] skip me",
                                "score": 10000,
                                "created_utc": fresh,
                                "subreddit": "x",
                                "url": "",
                                "permalink": "",
                            }
                        },
                    ]
                }
            },
        )
    )
    trends = TrendsDiscovery()
    try:
        out = await trends.from_reddit("en-US")
    finally:
        await trends.aclose()
    # NSFW row was dropped; only one survives.
    assert len(out) == 1
    item = out[0]
    assert "Big news" in item.text
    # 8000 score / 2h ≈ 4000 velocity (within float tolerance)
    assert 3000 < item.velocity < 5000


@pytest.mark.asyncio
@respx.mock
async def test_topics_normalises_and_merges_sources():
    respx.get("https://www.reddit.com/r/de/rising.json").mock(
        return_value=httpx.Response(
            200,
            json={"data": {"children": [
                {"data": {"title": "Same topic", "score": 1000,
                          "created_utc": (datetime.now(UTC) - timedelta(hours=2)).timestamp(),
                          "subreddit": "de", "url": "", "permalink": ""}},
                {"data": {"title": "Only on reddit", "score": 500,
                          "created_utc": (datetime.now(UTC) - timedelta(hours=2)).timestamp(),
                          "subreddit": "de", "url": "", "permalink": ""}},
            ]}},
        )
    )
    rss = """<?xml version="1.0"?>
    <rss xmlns:ht="http://www.google.com/trends/rss"><channel>
      <item><title>SAME TOPIC</title></item>
      <item><title>Only on google</title></item>
    </channel></rss>"""
    respx.get("https://trends.google.com/trends/trendingsearches/daily/rss").mock(
        return_value=httpx.Response(200, text=rss)
    )
    trends = TrendsDiscovery()
    try:
        topics = await trends.topics("de", max_results=10)
    finally:
        await trends.aclose()
    keys = [t.text.lower() for t in topics]
    # Reddit "Same topic" and gtrends "SAME TOPIC" should merge into one.
    same_hits = sum(1 for k in keys if "same topic" in k)
    assert same_hits == 1
    # We should still have reddit-only and gtrends-only items.
    assert any("only on reddit" in k for k in keys)
    assert any("only on google" in k for k in keys)


@pytest.mark.asyncio
@respx.mock
async def test_to_youtube_candidates_attaches_rising_score():
    # Topics → search → videos.list
    respx.get("https://www.googleapis.com/youtube/v3/search").mock(
        return_value=httpx.Response(
            200,
            json={"items": [{"id": {"videoId": "vidX"}}]},
        )
    )
    respx.get("https://www.googleapis.com/youtube/v3/videos").mock(
        return_value=httpx.Response(
            200,
            json={"items": [{
                "id": "vidX",
                "snippet": {"title": "X", "channelTitle": "C", "publishedAt": "2026-05-21T00:00:00Z"},
                "statistics": {"viewCount": "100"},
            }]},
        )
    )
    yt = YouTubeDiscovery("fake")
    trends = TrendsDiscovery()
    from shorts.discovery.trends import RisingTopic
    topic = RisingTopic(text="X", source="reddit", velocity=0.7, locale="en-US", extra={})
    try:
        candidates = await trends.to_youtube_candidates([topic], yt=yt, max_per_topic=1)
    finally:
        await yt.aclose()
        await trends.aclose()
    assert len(candidates) == 1
    assert candidates[0].video_id == "vidX"
    assert candidates[0].rising_score == 0.7
    assert candidates[0].rising_source == "reddit"
