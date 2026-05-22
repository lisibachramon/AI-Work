from pathlib import Path

from PIL import Image

from shorts.pipeline.thumbnail import render_thumbnail


def _make_frame(p: Path) -> Path:
    Image.new("RGB", (1280, 720), (40, 80, 120)).save(p, "JPEG")
    return p


def test_render_thumbnail_writes_expected_size(tmp_path: Path):
    base = _make_frame(tmp_path / "frame.jpg")
    out = tmp_path / "thumb.jpg"
    # The DejaVu font ships with the image; on test runners we may not have it,
    # so use any TrueType pillow can find — fallback to the bundled default.
    import PIL

    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        str(Path(PIL.__file__).parent / "DejaVuSans.ttf"),
    ]
    font = next((c for c in candidates if Path(c).exists()), None)
    if not font:
        # No usable TTF on this runner → skip rather than fail.
        import pytest

        pytest.skip("no TrueType font available on this runner")
    render_thumbnail(
        base_frame=base,
        title="A surprisingly good test thumbnail title",
        channel_name="TestChannel",
        font_path=font,
        out_path=out,
    )
    with Image.open(out) as im:
        assert im.size == (1280, 720)
        assert im.format == "JPEG"
