from shorts.pipeline.captions import WordTiming
from shorts.pipeline.longform import (
    chapter_timings,
    compute_chapter_timings,
    format_chapter_block,
)


def _words(text: str, start: float = 0.0, step: float = 0.5) -> list[WordTiming]:
    out = []
    t = start
    for w in text.split():
        out.append(WordTiming(text=w, start=t, end=t + step))
        t += step
    return out


def test_compute_chapter_timings_clamps_to_available_range():
    chapters = ["intro words", "middle words go here", "outro"]
    words = _words("intro words middle words go here outro and a bit more")
    starts = compute_chapter_timings(chapters, words)
    assert starts[0] == 0.0
    assert starts[1] > 0.0
    assert starts[2] > starts[1]
    assert all(s <= words[-1].end for s in starts)


def test_chapter_timings_assigns_end_from_next_start():
    chapters = [("Intro", "intro words"), ("Middle", "middle words go"), ("Outro", "outro")]
    words = _words("intro words middle words go outro extra")
    timings = chapter_timings(chapters, words, total_duration=words[-1].end)
    assert timings[0].end_seconds == timings[1].start_seconds
    assert timings[-1].end_seconds == words[-1].end


def test_format_chapter_block_first_is_zero():
    chapters = [("Intro", "a"), ("Middle", "b"), ("Outro", "c")]
    words = _words("a b c", start=5.0)  # intentionally non-zero
    timings = chapter_timings(chapters, words, total_duration=words[-1].end)
    block = format_chapter_block(timings)
    # First line must start with 0:00 even if the first word's start is > 0,
    # otherwise YouTube won't auto-detect chapters.
    assert block.splitlines()[0].startswith("0:00 ")


def test_format_chapter_block_uses_hms_when_over_an_hour():
    chapters = [("A", "x"), ("B", "y")]
    words = [WordTiming(text="x", start=0.0, end=1.0), WordTiming(text="y", start=3700.0, end=3702.0)]
    timings = chapter_timings(chapters, words, total_duration=3702.0)
    block = format_chapter_block(timings)
    # Second chapter is past 1 hour → format should switch to H:MM:SS.
    second = block.splitlines()[1]
    assert second.startswith("1:01:")
