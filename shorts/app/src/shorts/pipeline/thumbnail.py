"""Custom thumbnail generation. Custom > auto on Shorts shelves and on the
suggested feed — CTR delta is typically 30–60% on a new channel.

We pull a high-energy frame from the rendered short with ffmpeg's built-in
scene-change scoring (-vf thumbnail), then composite a bold title overlay
with the channel name. Output is 1280×720 (YouTube's expected thumbnail
size); YouTube re-crops it for the 9:16 Shorts shelf.
"""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path


async def pick_keyframe(video: Path, out: Path) -> Path:
    """Pull the strongest scene-change frame from the first 30s of the video."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not on PATH")
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-t", "30", "-i", str(video),
        "-vf", "thumbnail,scale=1280:-1",
        "-frames:v", "1",
        str(out),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    bout, _ = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg thumbnail extract failed: {bout.decode(errors='ignore')[-2000:]}")
    return out


def render_thumbnail(
    *,
    base_frame: Path,
    title: str,
    channel_name: str,
    font_path: str,
    out_path: Path,
    width: int = 1280,
    height: int = 720,
) -> Path:
    """Composite the keyframe + a bold title box. Uses Pillow only (no GPU)."""
    from PIL import Image, ImageDraw, ImageFilter, ImageFont

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.open(base_frame).convert("RGB")
    img = _fit(img, width, height)

    # Bottom-third gradient so text always reads against complex frames.
    gradient = Image.new("L", (1, height), 0)
    for y in range(height):
        # Solid black across the bottom 40% fading up; subject area stays clean.
        v = 0 if y < height * 0.55 else int(255 * min(1.0, (y - height * 0.55) / (height * 0.35)))
        gradient.putpixel((0, y), v)
    gradient = gradient.resize((width, height))
    shade = Image.new("RGB", (width, height), (0, 0, 0))
    img = Image.composite(shade, img, gradient)

    # Lightly sharpen the subject region (top 60%) for snappier crops.
    top = img.crop((0, 0, width, int(height * 0.6))).filter(ImageFilter.UnsharpMask(2, 100, 3))
    img.paste(top, (0, 0))

    draw = ImageDraw.Draw(img)
    title_clean = _clean_title(title)
    title_font_size = _fit_font_size(draw, title_clean, font_path, max_w=width - 80, max_size=92)
    title_font = ImageFont.truetype(font_path, title_font_size)
    chan_font = ImageFont.truetype(font_path, 36)

    lines = _wrap(title_clean, draw, title_font, max_w=width - 80)
    y = int(height * 0.62)
    for line in lines:
        _draw_text_with_outline(draw, (40, y), line, title_font, fill=(255, 255, 255), outline=(0, 0, 0))
        y += title_font_size + 6
    if channel_name:
        _draw_text_with_outline(
            draw, (40, height - 56), f"▶ {channel_name}", chan_font, fill=(255, 215, 0), outline=(0, 0, 0)
        )
    img.save(out_path, "JPEG", quality=88, optimize=True)
    return out_path


def _fit(img, w: int, h: int):
    from PIL import Image

    src_ratio = img.width / img.height
    dst_ratio = w / h
    if src_ratio > dst_ratio:
        new_w = int(img.height * dst_ratio)
        x = (img.width - new_w) // 2
        img = img.crop((x, 0, x + new_w, img.height))
    else:
        new_h = int(img.width / dst_ratio)
        y = (img.height - new_h) // 2
        img = img.crop((0, y, img.width, y + new_h))
    return img.resize((w, h), Image.LANCZOS)


def _clean_title(title: str) -> str:
    # Drop "#shorts" — distracts on the thumbnail.
    return " ".join(w for w in title.split() if not w.lower().startswith("#"))


def _fit_font_size(draw, text: str, font_path: str, *, max_w: int, max_size: int) -> int:
    from PIL import ImageFont

    for size in range(max_size, 36, -4):
        font = ImageFont.truetype(font_path, size)
        # Wrap into ≤3 lines and check the longest fits.
        lines = _wrap(text, draw, font, max_w)
        if len(lines) <= 3 and all(draw.textlength(line, font=font) <= max_w for line in lines):
            return size
    return 40


def _wrap(text: str, draw, font, max_w: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur: list[str] = []
    for w in words:
        cur.append(w)
        if draw.textlength(" ".join(cur), font=font) > max_w:
            cur.pop()
            if cur:
                lines.append(" ".join(cur))
            cur = [w]
    if cur:
        lines.append(" ".join(cur))
    return lines


def _draw_text_with_outline(draw, pos, text, font, *, fill, outline, width: int = 3) -> None:
    x, y = pos
    for dx in range(-width, width + 1):
        for dy in range(-width, width + 1):
            if dx or dy:
                draw.text((x + dx, y + dy), text, font=font, fill=outline)
    draw.text(pos, text, font=font, fill=fill)
