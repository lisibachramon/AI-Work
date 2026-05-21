"""End-to-end worker for one (locale, candidate) run.

Usage:
    python -m shorts.jobs.worker --locale en-US           # full run + upload
    python -m shorts.jobs.worker --locale de --dry-run    # render only, no upload
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from pathlib import Path

import typer
from slugify import slugify
from sqlalchemy import select

from shorts.config import Settings, get_settings
from shorts.db.models import Candidate, Published, get_sessionmaker
from shorts.discovery.youtube import YouTubeDiscovery
from shorts.pipeline import broll as broll_mod
from shorts.pipeline import captions as cap
from shorts.pipeline import clipper, compose
from shorts.pipeline.rank import rank
from shorts.pipeline.script import ScriptWriter

log = logging.getLogger("shorts.worker")

app = typer.Typer(add_completion=False)


@app.command()
def cli(
    locale: str = typer.Option(..., "--locale", "-l"),
    dry_run: bool = typer.Option(False, "--dry-run"),
    limit: int = typer.Option(1, "--limit"),
) -> None:
    """Run discovery → render → (optionally) upload for one locale."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(_run(locale=locale, dry_run=dry_run, limit=limit))


async def _run(*, locale: str, dry_run: bool, limit: int) -> None:
    settings = get_settings()
    yt = YouTubeDiscovery(settings.youtube_api_key)
    try:
        items = await yt.trending(locale, max_results=20)
    finally:
        await yt.aclose()
    if not items:
        log.warning("no trending items returned for locale=%s", locale)
        return

    ranked = rank(items, blocklist=settings.title_blocklist)
    Session = get_sessionmaker()
    rendered = 0
    for item, velocity in ranked:
        if rendered >= limit:
            break
        async with Session() as session:
            existing = await session.execute(
                select(Candidate).where(
                    Candidate.source == "youtube", Candidate.source_id == item.video_id
                )
            )
            if existing.scalar_one_or_none() is not None:
                continue
            cand = Candidate(
                source="youtube",
                source_id=item.video_id,
                locale=item.locale,
                title=item.title,
                channel=item.channel,
                url=item.url,
                view_count=item.view_count,
                published_at=item.published_at,
                velocity=velocity,
            )
            session.add(cand)
            await session.commit()
            await session.refresh(cand)

        try:
            outbox = await _render_one(settings, cand, dry_run=dry_run)
        except Exception:
            log.exception("render failed for %s", item.video_id)
            async with Session() as session:
                cand.status = "skipped"
                await session.merge(cand)
                await session.commit()
            continue

        if dry_run:
            log.info("dry-run wrote %s", outbox)
        else:
            from shorts.uploaders.youtube import UploadRequest, YouTubeUploader

            meta = json.loads((outbox / "metadata.json").read_text())
            video_id = YouTubeUploader(settings).upload(
                UploadRequest(
                    file_path=outbox / "final.mp4",
                    title=meta["title"],
                    description=meta["description"],
                    tags=meta["tags"],
                    category_id=settings.yt_category_id,
                    privacy=settings.yt_upload_privacy,
                )
            )
            log.info("uploaded https://youtube.com/watch?v=%s", video_id)
            async with Session() as session:
                session.add(
                    Published(
                        candidate_id=cand.id,
                        locale=cand.locale,
                        title=cand.title[:256],
                        youtube_video_id=video_id,
                        privacy=settings.yt_upload_privacy,
                        outbox_path=str(outbox),
                    )
                )
                cand.status = "processed"
                await session.merge(cand)
                await session.commit()
        rendered += 1


async def _render_one(settings: Settings, cand: Candidate, *, dry_run: bool) -> Path:
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    slug = slugify(cand.title)[:60] or cand.source_id
    base = settings.data_dir / "outbox" / ("dry" if dry_run else today) / f"{cand.source_id}-{slug}"
    base.mkdir(parents=True, exist_ok=True)

    writer = ScriptWriter(settings)
    script = await writer.write(
        locale=cand.locale,
        source_title=cand.title,
        source_channel=cand.channel,
        source_url=cand.url,
    )

    metadata = {
        "title": script.title,
        "description": script.description,
        "tags": script.tags,
        "locale": cand.locale,
        "source": {
            "platform": "youtube",
            "id": cand.source_id,
            "url": cand.url,
            "channel": cand.channel,
            "title": cand.title,
        },
        "fair_use": {
            "max_source_clip_seconds": settings.max_source_clip_seconds,
            "source_audio_dropped": True,
            "commentary": True,
        },
    }
    (base / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
    (base / "script.txt").write_text(script.body, encoding="utf-8")

    if dry_run:
        # In dry-run we stop here — full render needs TTS + ffmpeg + real B-roll.
        return base

    # --- TTS ---
    from shorts.pipeline.tts import XTTSVoice

    vo_path = base / "vo.wav"
    XTTSVoice(settings.tts_models_dir).synthesize(
        text=script.body, locale=cand.locale, out_path=vo_path
    )

    # --- captions via the existing whisper sidecar ---
    words = await cap.transcribe(vo_path, whisper_base_url=settings.whisper_base_url)
    ass_path = cap.write_ass(words, base / "captions.ass")
    _words_to_srt(words, base / "captions.srt")

    # --- B-roll: simple v1 — search Pexels by the script's first noun phrase ---
    bdir = base / "broll"
    bdir.mkdir(exist_ok=True)
    query = " ".join(cand.title.split()[:4])
    pex = broll_mod.PexelsBRoll(settings.pexels_api_key)
    try:
        raw = await pex.search_download(query=query, out_dir=bdir, max_results=4)
    finally:
        await pex.aclose()
    if not raw:
        raise RuntimeError("no B-roll available; cannot render without it")
    normalized: list[Path] = []
    for i, p in enumerate(raw):
        normalized.append(await broll_mod.normalize_to_9x16(p, bdir / f"norm_{i}.mp4", duration=8.0))

    # --- optional ≤8s cutaway of the source ---
    cut_clip: Path | None = None
    try:
        src_dl = await clipper.download(cand.url, out_dir=bdir / "src", cache_dir=settings.cache_dir)
        cut_clip = await clipper.cut(
            src_dl,
            start=10.0,
            duration=min(settings.max_source_clip_seconds, 8.0),
            out_path=bdir / "src_cut.mp4",
            max_seconds=settings.max_source_clip_seconds,
        )
        cut_clip = await broll_mod.normalize_to_9x16(cut_clip, bdir / "src_cut_9x16.mp4")
    except Exception:
        log.exception("source cutaway failed; rendering without it")
        cut_clip = None

    broll_paths = normalized if cut_clip is None else [cut_clip, *normalized]

    out = await compose.compose_short(
        compose.ComposeInputs(
            vo_path=vo_path,
            broll_paths=broll_paths,
            captions_ass=ass_path,
            title_text=script.title.replace("#shorts", "").strip(),
            attribution_text=f"Source: {cand.channel}",
            music_path=None,
        ),
        out_path=base / "final.mp4",
    )
    log.info("composed %s", out)
    return base


def _words_to_srt(words: list[cap.WordTiming], out: Path) -> None:
    lines: list[str] = []
    for i, w in enumerate(words, start=1):
        lines.append(f"{i}")
        lines.append(f"{_srt_ts(w.start)} --> {_srt_ts(w.end)}")
        lines.append(w.text)
        lines.append("")
    out.write_text("\n".join(lines), encoding="utf-8")


def _srt_ts(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


if __name__ == "__main__":
    app()
