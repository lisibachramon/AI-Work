"""16:9 long-form companion render pipeline.

Triggered when a Short pops (see jobs/longform_dispatcher). The flow is:

1. Re-use the Candidate the Short was built from.
2. Generate a chapter-based ~700–1500 word Claude script.
3. Synthesize the full VO (XTTS handles long-form fine; takes ~real-time on CPU).
4. Transcribe via the existing whisper sidecar to get word timestamps.
5. Use the VO + chapter boundaries to compute timestamps for the description.
6. Pull lots of Pexels B-roll (one query per chapter) and a handful of ≤8s
   source cutaways spread across the duration.
7. Compose to 1920×1080 with chapter titles overlaid at each boundary,
   subscribe-reminder card around the midpoint, end-card with subscribe CTA.

Fair-use posture is identical to the Short pipeline (≤8s per source clip,
source audio always dropped, mandatory original VO, attribution baked in).
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from dataclasses import dataclass
from pathlib import Path

from shorts.pipeline.captions import WordTiming

log = logging.getLogger("shorts.longform")


@dataclass(slots=True)
class ChapterTiming:
    title: str
    start_seconds: float
    end_seconds: float
    body: str


def compute_chapter_timings(
    chapters_text: list[str], words: list[WordTiming]
) -> list[float]:
    """Given the body text of each chapter and Whisper's word timings on the
    full VO, return the start-time (in seconds) of each chapter.

    Heuristic: count cumulative words per chapter; map to whisper's nth word.
    Whisper occasionally drops short tokens, so we clamp to the available range.
    """
    if not words:
        return [0.0 for _ in chapters_text]
    starts: list[float] = []
    cursor = 0
    n_words = len(words)
    for chapter in chapters_text:
        starts.append(words[min(cursor, n_words - 1)].start)
        cursor += max(1, len(chapter.split()))
    return starts


def chapter_timings(
    chapters: list[tuple[str, str]],  # (title, body) pairs
    words: list[WordTiming],
    total_duration: float,
) -> list[ChapterTiming]:
    starts = compute_chapter_timings([b for _t, b in chapters], words)
    out: list[ChapterTiming] = []
    for i, (title, body) in enumerate(chapters):
        end = starts[i + 1] if i + 1 < len(starts) else total_duration
        out.append(
            ChapterTiming(title=title, start_seconds=starts[i], end_seconds=end, body=body)
        )
    return out


def format_chapter_block(timings: list[ChapterTiming]) -> str:
    """YouTube auto-chapters are triggered by a description with timestamps
    matching `0:00 Title` on consecutive lines and the first one being
    exactly 0:00. We snap the first chapter to 0:00 to satisfy that rule."""
    lines: list[str] = []
    for i, t in enumerate(timings):
        ts = "0:00" if i == 0 else _ts(t.start_seconds)
        lines.append(f"{ts} {t.title}")
    return "\n".join(lines)


def _ts(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


async def normalize_to_16x9(src: Path, out: Path, *, duration: float | None = None) -> Path:
    """Scale + crop a clip to 1920×1080, drop audio."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not on PATH")
    out.parent.mkdir(parents=True, exist_ok=True)
    vf = "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30"
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(src),
        *(["-t", f"{duration:.3f}"] if duration else []),
        "-vf", vf,
        "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p",
        str(out),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    bout, _ = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"normalize_to_16x9 failed: {bout.decode(errors='ignore')[-2000:]}")
    return out


@dataclass(slots=True)
class LongformComposeInputs:
    vo_path: Path
    broll_paths: list[Path]  # already normalised to 1920x1080, no audio
    captions_ass: Path
    title_text: str
    attribution_text: str
    timings: list[ChapterTiming]
    subscribe_reminder_text: str = "Subscribe for weekly deep-dives"
    end_card_text: str = "Thanks for watching — subscribe!"


async def compose_longform(inputs: LongformComposeInputs, *, out_path: Path) -> Path:
    """Long-form composition: chapter cards, subscribe reminder at the
    midpoint, end card on the last 8s, captions burned in throughout."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not inputs.broll_paths:
        raise ValueError("at least one B-roll clip is required")
    work = out_path.parent
    concat_list = work / "broll_longform.txt"
    concat_list.write_text("\n".join(f"file '{p.resolve()}'" for p in inputs.broll_paths))
    stitched = work / "stitched_longform.mp4"
    await _run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", str(concat_list),
            "-c", "copy", str(stitched),
        ]
    )
    total = inputs.timings[-1].end_seconds if inputs.timings else 0.0
    sub_at = max(60.0, total * 0.5)  # show reminder at midpoint, no earlier than 1:00
    end_from = max(total - 8.0, 0.0)

    chapter_cards = []
    for t in inputs.timings:
        safe = _esc(t.title)
        chapter_cards.append(
            f"drawtext=text='{safe}':fontcolor=white:fontsize=56:"
            "box=1:boxcolor=black@0.55:boxborderw=18:x=60:y=h*0.82:"
            f"enable='between(t,{t.start_seconds:.2f},{t.start_seconds + 4:.2f})'"
        )
    overlays = [
        f"subtitles='{inputs.captions_ass}'",
        (
            f"drawtext=text='{_esc(inputs.title_text)}':fontcolor=white:fontsize=60:"
            "box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h*0.12:"
            "enable='lt(t,3)'"
        ),
        *chapter_cards,
        (
            f"drawtext=text='{_esc(inputs.subscribe_reminder_text)}':fontcolor=yellow:fontsize=44:"
            "box=1:boxcolor=black@0.65:boxborderw=14:x=(w-text_w)/2:y=h*0.86:"
            f"enable='between(t,{sub_at:.2f},{sub_at + 4:.2f})'"
        ),
        (
            f"drawtext=text='{_esc(inputs.end_card_text)}':fontcolor=white:fontsize=64:"
            "box=1:boxcolor=black@0.7:boxborderw=24:x=(w-text_w)/2:y=h*0.7:"
            f"enable='gt(t,{end_from:.2f})'"
        ),
        (
            f"drawtext=text='{_esc(inputs.attribution_text)}':fontcolor=white:fontsize=32:"
            "box=1:boxcolor=black@0.6:boxborderw=10:x=(w-text_w)/2:y=h*0.9:"
            "enable='gt(t,duration-15)'"
        ),
    ]
    cmd: list[str] = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-stream_loop", "-1", "-i", str(stitched),
        "-i", str(inputs.vo_path),
        "-filter_complex",
        f"[0:v]{','.join(overlays)}[v];[1:a]volume=1.0[aout]",
        "-map", "[v]", "-map", "[aout]",
        "-shortest",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        str(out_path),
    ]
    await _run(cmd)
    return out_path


def _esc(s: str) -> str:
    return s.replace("'", "'\\''").replace(":", r"\:")


async def _run(cmd: list[str]) -> None:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    out, _ = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg longform failed: {out.decode(errors='ignore')[-2000:]}")
