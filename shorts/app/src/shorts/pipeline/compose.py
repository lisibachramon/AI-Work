"""Final ffmpeg composition: stitches B-roll under the VO, burns in captions,
adds title/end cards, outputs a 1080x1920 mp4."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class ComposeInputs:
    vo_path: Path  # mono/stereo wav or mp3 of the voice-over
    broll_paths: list[Path]  # already normalized to 1080x1920, no audio
    captions_ass: Path  # .ass subtitles, timed to vo_path
    title_text: str  # first-frame overlay (first 1.5s)
    attribution_text: str  # last-frame overlay (last 2s)
    music_path: Path | None  # optional ducked background bed


async def compose_short(inputs: ComposeInputs, *, out_path: Path) -> Path:
    """Concatenate B-roll to cover the VO length, layer the VO, burn captions."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not inputs.broll_paths:
        raise ValueError("at least one B-roll clip is required")
    work = out_path.parent
    concat_list = work / "broll.txt"
    concat_list.write_text("\n".join(f"file '{p.resolve()}'" for p in inputs.broll_paths))
    stitched = work / "stitched.mp4"
    await _run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", str(concat_list),
            "-c", "copy", str(stitched),
        ]
    )
    title_safe = inputs.title_text.replace("'", "'\\''").replace(":", r"\:")
    attr_safe = inputs.attribution_text.replace("'", "'\\''").replace(":", r"\:")
    filters = [
        f"subtitles='{inputs.captions_ass}'",
        # Title card: visible for the first 1.5s.
        (
            f"drawtext=text='{title_safe}':fontcolor=white:fontsize=64:"
            "box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h*0.12:"
            "enable='lt(t,1.5)'"
        ),
        # Attribution: last 2s.
        (
            f"drawtext=text='{attr_safe}':fontcolor=white:fontsize=36:"
            "box=1:boxcolor=black@0.6:boxborderw=12:x=(w-text_w)/2:y=h*0.85:"
            "enable='gt(t,duration-2)'"
        ),
    ]
    cmd: list[str] = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-stream_loop", "-1", "-i", str(stitched),
        "-i", str(inputs.vo_path),
    ]
    if inputs.music_path is not None:
        cmd += ["-stream_loop", "-1", "-i", str(inputs.music_path)]
        amix = "[1:a][2:a:0]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=200[duck];[duck]volume=1.0[aout]"
    else:
        amix = "[1:a]volume=1.0[aout]"
    cmd += [
        "-filter_complex",
        f"[0:v]{','.join(filters)}[v];{amix}",
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


async def _run(cmd: list[str]) -> None:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    out, _ = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed ({cmd[0]}): {out.decode(errors='ignore')[-2000:]}")
