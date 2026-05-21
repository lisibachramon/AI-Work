import json

from shorts.pipeline.script import _parse


def test_parse_extracts_variants_and_hook():
    payload = {
        "title": "Why X is everywhere",
        "body": "This is the hook line. Body follows. Kicker.",
        "description": "Some commentary.",
        "tags": ["news", "x", "trends"],
        "title_variants": [
            "The truth about X",
            "X explained in 30s",
            "X is bigger than you think",
        ],
        "hook_variants": [
            "This is the hook line",
            "Everyone is wrong about X",
            "Three reasons X exploded",
        ],
    }
    out = _parse(json.dumps(payload), fallback_attribution=("Ch", "https://yt.example/x"))
    assert out.title.endswith("#shorts")
    assert all(v.endswith("#shorts") for v in out.title_variants)
    assert out.hook == "This is the hook line"
    assert "Source: Ch" in out.description
    assert "fair use" in out.description.lower()
    assert "https://yt.example/x" in out.description
    assert len(out.title_variants) == 3
    assert len(out.hook_variants) == 3


def test_parse_handles_codefence():
    payload = {
        "title": "T #shorts",
        "body": "Hook only.",
        "description": "Already cites Ch and https://yt.example/y. Fair use note.",
        "tags": [],
        "title_variants": [],
        "hook_variants": ["Hook only"],
    }
    text = "```json\n" + json.dumps(payload) + "\n```"
    out = _parse(text, fallback_attribution=("Ch", "https://yt.example/y"))
    assert out.title == "T #shorts"
    assert out.hook == "Hook only"
