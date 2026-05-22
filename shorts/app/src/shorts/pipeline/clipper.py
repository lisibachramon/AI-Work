"""Fair-use clipper: download a source video and cut a single ≤8s, video-only clip.

The duration cap is enforced HERE so every entry point uses the same limit.
Source audio is dropped (-an). The hard cap is wired to
Settings.max_source_clip_seconds — do not raise it without legal review.
"""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path


class ClipTooLong(Exception):
    pass


async def download(url: str, *, out_dir: Path, cache_dir: Path | None = None) -> Path:
    """Download a YouTube/TikTok URL to mp4. Caches downloads by id."""
    out_dir.mkdir(parents=True, exist_ok=True)
    args = [
        "yt-dlp",
        "-f", "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]/b",
        "-o", str(out_dir / "%(id)s.%(ext)s"),
        "--no-playlist",
        "--restrict-filenames",
        url,
    ]
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        args += ["--paths", f"temp:{cache_dir}"]
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    out, _ = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {out.decode(errors='ignore')[-2000:]}")
    files = sorted(out_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        raise RuntimeError("yt-dlp produced no mp4")
    return files[0]


async def cut(
    src: Path,
    *,
    start: float,
    duration: float,
    out_path: Path,
    max_seconds: float,
) -> Path:
    """Cut a video-only segment. Raises ClipTooLong if duration > max_seconds."""
    if duration > max_seconds:
        raise ClipTooLong(
            f"Requested clip of {duration:.1f}s exceeds fair-use cap of {max_seconds:.1f}s"
        )
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not on PATH")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-i", str(src),
        "-t", f"{duration:.3f}",
        "-an",  # drop the source audio; mandated by fair-use posture.
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p",
        str(out_path),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    out, _ = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg cut failed: {out.decode(errors='ignore')[-2000:]}")
    return out_path
