import json

from shorts.pipeline.script import _parse


def test_parse_longform_returns_chapters_and_body():
    payload = {
        "title": "The full story of X",
        "chapters": [
            {"title": "Intro", "body": "Welcome. Here is the hook."},
            {"title": "What happened", "body": "First, the facts. Then the analysis."},
            {"title": "Why it matters", "body": "Second, the stakes."},
            {"title": "Wrap-up", "body": "Subscribe for more."},
        ],
        "description": "Some description.\n[CHAPTERS]",
        "tags": ["news", "analysis", "x"],
        "title_variants": ["X explained", "What everyone missed about X", "The real story of X"],
    }
    out = _parse(json.dumps(payload), fallback_attribution=("Ch", "https://yt/x"), kind="longform")
    assert out.kind == "longform"
    assert len(out.chapters) == 4
    assert "#shorts" not in out.title.lower()
    # All chapter bodies concatenated into out.body.
    assert "Subscribe for more" in out.body
    # Attribution and fair-use auto-injected.
    assert "Source: Ch" in out.description
    assert "fair use" in out.description.lower()
    assert "[CHAPTERS]" in out.description  # left as a marker for the worker to fill in
    assert len(out.title_variants) == 3
    # No #shorts on long-form title variants.
    assert not any("#shorts" in v.lower() for v in out.title_variants)
