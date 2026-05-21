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

from shorts.analytics.feedback import recent_winners
from shorts.config import Settings, get_settings
from shorts.db.models import Candidate, Published, get_sessionmaker
from shorts.discovery.youtube import YouTubeDiscovery
from shorts.monetization import AffiliateInjector, load_rules
from shorts.pipeline import broll as broll_mod
from shorts.pipeline import captions as cap
from shorts.pipeline import clipper, compose, distribution, thumbnail
from shorts.pipeline.rank import rank
from shorts.pipeline.script import CommentaryScript, ScriptWriter

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
            cand_id = cand.id  # avoid lazy reload after the session closes

        try:
            outbox, script = await _render_one(settings, cand, dry_run=dry_run)
        except Exception:
            log.exception("render failed for %s", item.video_id)
            async with Session() as session:
                cand.status = "skipped"
                await session.merge(cand)
                await session.commit()
            continue

        if dry_run:
            log.info("dry-run wrote %s", outbox)
            rendered += 1
            continue

        from shorts.uploaders.youtube import UploadRequest, YouTubeUploader

        meta = json.loads((outbox / "metadata.json").read_text())
        thumb = outbox / "thumbnail.jpg"
        cta = _format_cta(settings.cta_comment_template, video_url=None) if settings.post_pinned_comment else None
        upload = YouTubeUploader(settings, locale=cand.locale).upload(
            UploadRequest(
                file_path=outbox / "final.mp4",
                title=meta["title"],
                description=meta["description"],
                tags=meta["tags"],
                category_id=settings.yt_category_id,
                privacy=settings.yt_upload_privacy,
                thumbnail_path=thumb if (settings.upload_custom_thumbnail and thumb.exists()) else None,
                cta_comment=cta,
            )
        )
        log.info("uploaded %s thumb=%s cta=%s", upload.url, upload.thumbnail_set, bool(upload.cta_comment_id))

        async with Session() as session:
            session.add(
                Published(
                    candidate_id=cand_id,
                    locale=cand.locale,
                    title=cand.title[:256],
                    hook=script.hook[:512],
                    youtube_video_id=upload.video_id,
                    privacy=settings.yt_upload_privacy,
                    outbox_path=str(outbox),
                    variants_json={
                        "title_variants": script.title_variants,
                        "hook_variants": script.hook_variants,
                    },
                    affiliate_count=int(meta.get("affiliate_count", 0)),
                )
            )
            cand.status = "processed"
            await session.merge(cand)
            await session.commit()
        rendered += 1


async def _render_one(
    settings: Settings, cand: Candidate, *, dry_run: bool
) -> tuple[Path, CommentaryScript]:
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    slug = slugify(cand.title)[:60] or cand.source_id
    base = settings.data_dir / "outbox" / ("dry" if dry_run else today) / f"{cand.source_id}-{slug}"
    base.mkdir(parents=True, exist_ok=True)

    # --- analytics feedback: pull this channel's recent winners as few-shot
    winners = []
    if settings.yt_analytics_enabled:
        Session = get_sessionmaker()
        async with Session() as session:
            winners = await recent_winners(
                session,
                locale=cand.locale,
                min_views=settings.yt_winner_min_views,
                limit=5,
            )

    writer = ScriptWriter(settings)
    script = await writer.write(
        locale=cand.locale,
        source_title=cand.title,
        source_channel=cand.channel,
        source_url=cand.url,
        winners=winners,
    )

    # --- affiliate injection: only adds to the description, never alters VO
    affiliates_block = ""
    affiliate_count = 0
    if settings.affiliates_yaml_path:
        rules = load_rules(settings.affiliates_yaml_path, amazon_tag=settings.amazon_tag)
        injector = AffiliateInjector(rules, redirect_domain=settings.link_redirect_domain)
        matches = injector.find(cand.title, script.body)
        affiliates_block = injector.description_block(matches)
        affiliate_count = len(matches)

    description = script.description
    if affiliates_block:
        description = f"{description}\n\n{affiliates_block}"

    metadata = {
        "title": script.title,
        "description": description,
        "tags": script.tags,
        "hook": script.hook,
        "title_variants": script.title_variants,
        "hook_variants": script.hook_variants,
        "locale": cand.locale,
        "affiliate_count": affiliate_count,
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
        # Still emit platform metadata + (if there's a sample frame) thumbnail so
        # the bundle is inspectable without uploads.
        distribution.write_platform_metadata(
            out_dir=base,
            base_title=script.title,
            description=description,
            tags=script.tags,
            cta_line=_format_cta(settings.cta_comment_template, video_url=None),
        )
        return base, script

    # --- TTS (voice-cloned if a host sample is configured) ---
    from shorts.pipeline.tts import XTTSVoice

    vo_path = base / "vo.wav"
    speaker_wav = Path(settings.host_voice_sample_path) if settings.host_voice_sample_path else None
    XTTSVoice(settings.tts_models_dir).synthesize(
        text=script.body,
        locale=cand.locale,
        out_path=vo_path,
        speaker_wav=speaker_wav if speaker_wav and speaker_wav.exists() else None,
    )

    # --- captions via the existing whisper sidecar ---
    words = await cap.transcribe(vo_path, whisper_base_url=settings.whisper_base_url)
    ass_path = cap.write_ass(words, base / "captions.ass")
    _words_to_srt(words, base / "captions.srt")

    # --- B-roll ---
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

    final = await compose.compose_short(
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
    log.info("composed %s", final)

    # --- custom thumbnail
    try:
        keyframe = await thumbnail.pick_keyframe(final, base / "keyframe.jpg")
        thumbnail.render_thumbnail(
            base_frame=keyframe,
            title=script.title,
            channel_name=settings.channel_name,
            font_path=settings.thumbnail_font_path,
            out_path=base / "thumbnail.jpg",
        )
    except Exception:
        log.exception("thumbnail generation failed; falling back to YouTube auto-thumb")

    # --- multi-aspect re-exports
    for aname in settings.render_aspects:
        spec = distribution.ASPECTS.get(aname)
        if spec is None:
            log.warning("unknown render_aspect=%s, skipping", aname)
            continue
        try:
            await distribution.re_export(final, spec, base)
        except Exception:
            log.exception("re-export failed for aspect=%s", aname)

    # --- platform metadata bundles
    distribution.write_platform_metadata(
        out_dir=base,
        base_title=script.title,
        description=description,
        tags=script.tags,
        cta_line=_format_cta(settings.cta_comment_template, video_url=None),
    )

    return base, script


def _format_cta(template: str, *, video_url: str | None) -> str:
    if not template:
        return ""
    return template.replace("{video_url}", video_url or "")


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
