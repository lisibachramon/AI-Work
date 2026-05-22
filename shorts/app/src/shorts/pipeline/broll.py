"""B-roll picker: prefers Pexels stock; uses Plex for variety if configured."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

import httpx


@dataclass(slots=True)
class BRollClip:
    file_path: Path
    duration_seconds: float
    source: str  # "pexels" | "plex"


class PexelsBRoll:
    BASE_URL = "https://api.pexels.com/videos"

    def __init__(self, api_key: str, *, client: httpx.AsyncClient | None = None) -> None:
        self.api_key = api_key
        self._client = client or httpx.AsyncClient(timeout=60.0)

    async def search_download(self, *, query: str, out_dir: Path, max_results: int = 5) -> list[Path]:
        if not self.api_key:
            return []
        out_dir.mkdir(parents=True, exist_ok=True)
        r = await self._client.get(
            f"{self.BASE_URL}/search",
            params={"query": query, "per_page": max_results, "orientation": "portrait"},
            headers={"Authorization": self.api_key},
        )
        r.raise_for_status()
        paths: list[Path] = []
        for vid in r.json().get("videos", []):
            files = sorted(
                vid.get("video_files", []),
                key=lambda f: f.get("height", 0),
                reverse=True,
            )
            pick = next((f for f in files if f.get("height", 0) <= 1920), files[0] if files else None)
            if not pick:
                continue
            target = out_dir / f"pexels_{vid['id']}.mp4"
            async with self._client.stream("GET", pick["link"]) as resp:
                resp.raise_for_status()
                with target.open("wb") as fh:
                    async for chunk in resp.aiter_bytes(64 * 1024):
                        fh.write(chunk)
            paths.append(target)
        return paths

    async def aclose(self) -> None:
        await self._client.aclose()


async def normalize_to_9x16(src: Path, out: Path, *, duration: float | None = None) -> Path:
    """Scale + crop a clip to 1080x1920, drop audio. Used for every B-roll."""
    out.parent.mkdir(parents=True, exist_ok=True)
    vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30"
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
        raise RuntimeError(f"ffmpeg normalize failed: {bout.decode(errors='ignore')[-2000:]}")
    return out
