"""Multi-aspect re-exports + platform-specific metadata bundles.

Every rendered short ships with siblings for the other platforms so the
operator (or a future direct-upload integration) can hand them off without
re-encoding.

Outbox layout per video:
    final.mp4               # 1080×1920 (the source)
    final_1x1.mp4           # 1080×1080 (Instagram feed)
    final_16x9.mp4          # 1920×1080 (X, YouTube long-form companion)
    thumbnail.jpg           # 1280×720 custom thumbnail
    metadata.json           # YouTube (rich)
    tiktok.json             # caption + hashtag block (TikTok)
    instagram.json          # caption + first-30-hashtags (IG Reels)
    twitter.json            # ≤280 chars body
"""

from __future__ import annotations

import asyncio
import json
import shutil
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class AspectSpec:
    name: str  # "9x16" | "1x1" | "16x9"
    width: int
    height: int

    @property
    def filename(self) -> str:
        return f"final_{self.name}.mp4"


ASPECTS: dict[str, AspectSpec] = {
    "9x16": AspectSpec("9x16", 1080, 1920),
    "1x1": AspectSpec("1x1", 1080, 1080),
    "16x9": AspectSpec("16x9", 1920, 1080),
}


async def re_export(src: Path, aspect: AspectSpec, out_dir: Path) -> Path:
    """Re-export `src` (assumed 1080×1920) into the requested aspect.

    For 1×1 we crop to the center square. For 16×9 we use a "blurred-fill"
    treatment: scale the source vertically to fit the 16:9 box height with a
    blurred bg, no letterboxing. Returns the new file path.
    """
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not on PATH")
    out = out_dir / aspect.filename
    if aspect.name == "9x16":
        # Just copy — we already have this aspect.
        if src.resolve() != out.resolve():
            out.write_bytes(src.read_bytes())
        return out
    if aspect.name == "1x1":
        vf = f"scale={aspect.width}:-1,crop={aspect.width}:{aspect.height}"
    elif aspect.name == "16x9":
        # Blurred 16:9 bg + the original 9:16 layered in the centre.
        vf = (
            f"split[bg][fg];"
            f"[bg]scale={aspect.width}:{aspect.height}:force_original_aspect_ratio=increase,"
            f"crop={aspect.width}:{aspect.height},boxblur=20:1[bg2];"
            f"[fg]scale=-1:{aspect.height}[fg2];"
            f"[bg2][fg2]overlay=(W-w)/2:0"
        )
    else:
        raise ValueError(f"unknown aspect: {aspect.name}")
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(src),
        "-filter_complex" if aspect.name == "16x9" else "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        str(out),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    bout, _ = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"re-export failed ({aspect.name}): {bout.decode(errors='ignore')[-2000:]}")
    return out


def write_platform_metadata(
    *,
    out_dir: Path,
    base_title: str,
    description: str,
    tags: list[str],
    cta_line: str = "",
) -> dict[str, Path]:
    """Emit per-platform .json files with platform-appropriate copy."""
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    title_clean = base_title.replace("#shorts", "").strip()

    # TikTok: up to 2200 chars caption, ~150 chars rendered. Hashtag-heavy.
    tt_caption = " ".join([title_clean, *(f"#{t}" for t in tags[:8])])
    paths["tiktok"] = _write_json(out_dir / "tiktok.json", {
        "caption": tt_caption[:2200],
        "hashtags": [f"#{t}" for t in tags[:8]],
        "cta": cta_line,
    })

    # Instagram Reels: 2200 char caption, but algorithm dings >30 hashtags
    # and rewards captions of 50–250 chars. We put hashtags last on a new line.
    ig_caption = title_clean
    if cta_line:
        ig_caption = f"{ig_caption}\n\n{cta_line}"
    ig_caption = f"{ig_caption}\n\n" + " ".join(f"#{t}" for t in tags[:30])
    paths["instagram"] = _write_json(out_dir / "instagram.json", {
        "caption": ig_caption[:2200],
        "hashtags": [f"#{t}" for t in tags[:30]],
    })

    # X / Twitter: 280 chars hard limit. Use the title + one hashtag + the CTA.
    twitter_body = title_clean
    if cta_line:
        twitter_body = f"{twitter_body}\n{cta_line}"
    if tags:
        twitter_body = f"{twitter_body} #{tags[0]}"
    paths["twitter"] = _write_json(out_dir / "twitter.json", {
        "body": twitter_body[:280],
    })

    # LinkedIn (free bonus — sometimes commentary clips do well on LI):
    li_body = f"{title_clean}\n\n{description}"
    paths["linkedin"] = _write_json(out_dir / "linkedin.json", {
        "body": li_body[:3000],
    })

    return paths


def _write_json(path: Path, payload: dict) -> Path:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    return path
