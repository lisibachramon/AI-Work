import pytest

from shorts.pipeline.clipper import ClipTooLong, cut


@pytest.mark.asyncio
async def test_cut_rejects_over_cap(tmp_path):
    src = tmp_path / "fake.mp4"
    src.write_bytes(b"\x00")  # never read — we expect to short-circuit first
    with pytest.raises(ClipTooLong):
        await cut(
            src,
            start=0.0,
            duration=10.0,
            out_path=tmp_path / "out.mp4",
            max_seconds=8.0,
        )
