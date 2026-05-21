import json
from pathlib import Path

from shorts.pipeline.distribution import ASPECTS, write_platform_metadata


def test_aspects_sizes():
    assert ASPECTS["9x16"].width == 1080 and ASPECTS["9x16"].height == 1920
    assert ASPECTS["1x1"].width == 1080 and ASPECTS["1x1"].height == 1080
    assert ASPECTS["16x9"].width == 1920 and ASPECTS["16x9"].height == 1080


def test_platform_metadata_caps(tmp_path: Path):
    paths = write_platform_metadata(
        out_dir=tmp_path,
        base_title="A very interesting take on the news #shorts",
        description=(
            "Body of the description.\n"
            "Source: ChannelName — https://youtube.com/x\n"
            "Commentary, criticism & news — fair use."
        ),
        tags=[f"tag{i}" for i in range(40)],
        cta_line="Newsletter: https://example.com/nl",
    )
    tt = json.loads(paths["tiktok"].read_text())
    ig = json.loads(paths["instagram"].read_text())
    tw = json.loads(paths["twitter"].read_text())
    li = json.loads(paths["linkedin"].read_text())

    assert "#shorts" not in tt["caption"]  # we strip the #shorts marker
    assert tt["hashtags"][0].startswith("#")
    assert len(tt["hashtags"]) <= 8

    # IG cap is 30 hashtags; we have 40 tags incoming.
    assert len(ig["hashtags"]) == 30
    assert "Newsletter:" in ig["caption"]
    assert len(ig["caption"]) <= 2200

    # X / Twitter hard limit is 280.
    assert len(tw["body"]) <= 280

    assert len(li["body"]) <= 3000
