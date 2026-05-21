"""Captions via the existing whisper sidecar.

The kitchen stack already runs faster-whisper at http://whisper:9000 on
proxy_default. We POST the rendered VO mp3, get back timestamped words,
and write an .ass subtitle file with a chunked, two-words-at-a-time
karaoke style that reads well in 9:16.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import httpx


@dataclass(slots=True)
class WordTiming:
    text: str
    start: float
    end: float


async def transcribe(
    audio: Path, *, whisper_base_url: str, language: str | None = None
) -> list[WordTiming]:
    """Call the faster-whisper sidecar's /asr endpoint."""
    params = {"output": "json", "word_timestamps": "true"}
    if language:
        params["language"] = language
    async with httpx.AsyncClient(timeout=300.0) as client:
        with audio.open("rb") as fh:
            r = await client.post(
                f"{whisper_base_url.rstrip('/')}/asr",
                params=params,
                files={"audio_file": (audio.name, fh, "audio/mpeg")},
            )
        r.raise_for_status()
    data = r.json()
    words: list[WordTiming] = []
    for seg in data.get("segments", []):
        for w in seg.get("words", []) or []:
            words.append(WordTiming(text=w["word"].strip(), start=w["start"], end=w["end"]))
    return words


def write_ass(words: list[WordTiming], out: Path, *, chunk_size: int = 2) -> Path:
    """Emit a vertical-safe karaoke .ass file. Two words per cue by default."""
    out.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1080\nPlayResY: 1920\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour,"
        " Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Big, DejaVu Sans, 88, &H00FFFFFF, &H00000000, &H80000000, 1, 0, 1, 4, 2, 2, 60, 60, 320, 1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    lines: list[str] = []
    for i in range(0, len(words), chunk_size):
        chunk = words[i : i + chunk_size]
        if not chunk:
            continue
        text = " ".join(w.text for w in chunk)
        lines.append(
            f"Dialogue: 0,{_ts(chunk[0].start)},{_ts(chunk[-1].end)},Big,,0,0,0,,{text}"
        )
    out.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
    return out


def _ts(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"
