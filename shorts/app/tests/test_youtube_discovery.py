import httpx
import pytest
import respx

from shorts.discovery.youtube import YouTubeDiscovery


@pytest.mark.asyncio
@respx.mock
async def test_trending_parses_items():
    route = respx.get("https://www.googleapis.com/youtube/v3/videos").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [
                    {
                        "id": "abc",
                        "snippet": {
                            "title": "T",
                            "channelTitle": "C",
                            "publishedAt": "2026-05-21T12:00:00Z",
                        },
                        "statistics": {"viewCount": "12345"},
                    }
                ]
            },
        )
    )
    yt = YouTubeDiscovery(api_key="fake")
    try:
        items = await yt.trending("en-US")
    finally:
        await yt.aclose()
    assert route.called
    assert len(items) == 1
    assert items[0].video_id == "abc"
    assert items[0].view_count == 12345
    assert items[0].url == "https://www.youtube.com/watch?v=abc"
