"""End-to-end worker for one (locale, candidate) run.

Usage:
    python -m shorts.jobs.worker run --locale en-US           # discover + render + upload
    python -m shorts.jobs.worker run --locale de --dry-run    # render only, no upload
    python -m shorts.jobs.worker longform --published-id 42   # explicit long-form for a Short
    python -m shorts.jobs.worker dispatch-longform            # daily scan + queue
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
from shorts.discovery.trends import TrendsDiscovery
from shorts.discovery.youtube import YouTubeDiscovery
from shorts.monetization import AffiliateInjector, load_rules
from shorts.pipeline import broll as broll_mod
from shorts.pipeline import captions as cap
from shorts.pipeline import clipper, compose, distribution, thumbnail
from shorts.pipeline import longform as lf
from shorts.pipeline.rank import rank
from shorts.pipeline.script import CommentaryScript, ScriptWriter

log = logging.getLogger("shorts.worker")

app = typer.Typer(add_completion=False, no_args_is_help=True)


def _configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@app.command("run")
def cli_run(
    locale: str = typer.Option(..., "--locale", "-l"),
    dry_run: bool = typer.Option(False, "--dry-run"),
    limit: int = typer.Option(1, "--limit"),
) -> None:
    """Run discovery → render → (optionally) upload for one locale."""
    _configure_logging()
    asyncio.run(_run(locale=locale, dry_run=dry_run, limit=limit))


@app.command("longform")
def cli_longform(
    published_id: int = typer.Option(..., "--published-id"),
    dry_run: bool = typer.Option(False, "--dry-run"),
) -> None:
    """Render the long-form companion for a specific published Short."""
    _configure_logging()
    asyncio.run(_run_longform(parent_published_id=published_id, dry_run=dry_run))


@app.command("dispatch-longform")
def cli_dispatch_longform(dry_run: bool = typer.Option(False, "--dry-run")) -> None:
    """Scan performance + queue long-forms for any Short that crossed the trigger."""
    _configure_logging()
    asyncio.run(_dispatch_longform(dry_run=dry_run))


async def _discover(settings: Settings, locale: str) -> list:
    """Return ranked items merged from YouTube most-popular + rising trends."""
    yt = YouTubeDiscovery(settings.youtube_api_key)
    rising_items = []
    try:
        items = await yt.trending(locale, max_results=20)
        if settings.rising_trends_enabled:
            trends = TrendsDiscovery()
            try:
                topics = await trends.topics(locale, max_results=settings.rising_topics_per_locale)
                rising_items = await trends.to_youtube_candidates(
                    topics, yt=yt, max_per_topic=1, window_hours=settings.rising_window_hours
                )
                if rising_items:
                    log.info("rising-trends added %d candidate(s) for locale=%s", len(rising_items), locale)
            except Exception:
                log.exception("rising-trends discovery failed for locale=%s", locale)
            finally:
                await trends.aclose()
    finally:
        await yt.aclose()
    merged = _dedupe_by_id(items + rising_items)
    return rank(merged, blocklist=settings.title_blocklist)


def _dedupe_by_id(items: list) -> list:
    seen: set[str] = set()
    out = []
    for it in items:
        if it.video_id in seen:
            continue
        seen.add(it.video_id)
        out.append(it)
    return out


async def _run(*, locale: str, dry_run: bool, limit: int) -> None:
    settings = get_settings()
    ranked = await _discover(settings, locale)
    if not ranked:
        log.warning("no candidates discovered for locale=%s", locale)
        return

    Session = get_sessionmaker()
    rendered = 0
    for item, score in ranked:
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
                velocity=score,
                extra={
                    "rising_score": item.rising_score,
                    "rising_source": item.rising_source,
                } if item.rising_score else {},
            )
            session.add(cand)
            await session.commit()
            await session.refresh(cand)
            cand_id = cand.id

        try:
            outbox, script = await _render_short(settings, cand, dry_run=dry_run)
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
                    kind="short",
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


async def _render_short(
    settings: Settings, cand: Candidate, *, dry_run: bool
) -> tuple[Path, CommentaryScript]:
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    slug = slugify(cand.title)[:60] or cand.source_id
    base = settings.data_dir / "outbox" / ("dry" if dry_run else today) / f"{cand.source_id}-{slug}"
    base.mkdir(parents=True, exist_ok=True)

    winners = []
    if settings.yt_analytics_enabled:
        Session = get_sessionmaker()
        async with Session() as session:
            winners = await recent_winners(
                session, locale=cand.locale, min_views=settings.yt_winner_min_views, limit=5
            )

    writer = ScriptWriter(settings)
    script = await writer.write(
        locale=cand.locale,
        source_title=cand.title,
        source_channel=cand.channel,
        source_url=cand.url,
        winners=winners,
        kind="short",
    )

    description = _inject_affiliates(settings, script.body, cand.title, base_desc=script.description)
    affiliate_count = description.count("/go/") if "/go/" in description else 0

    metadata = {
        "title": script.title,
        "description": description,
        "tags": script.tags,
        "hook": script.hook,
        "title_variants": script.title_variants,
        "hook_variants": script.hook_variants,
        "locale": cand.locale,
        "affiliate_count": affiliate_count,
        "kind": "short",
        "source": _source_block(cand),
        "fair_use": _fair_use_block(settings),
    }
    (base / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
    (base / "script.txt").write_text(script.body, encoding="utf-8")

    if dry_run:
        distribution.write_platform_metadata(
            out_dir=base,
            base_title=script.title,
            description=description,
            tags=script.tags,
            cta_line=_format_cta(settings.cta_comment_template, video_url=None),
        )
        return base, script

    vo_path = await _synth_vo(settings, text=script.body, locale=cand.locale, out=base / "vo.wav")
    words = await cap.transcribe(vo_path, whisper_base_url=settings.whisper_base_url)
    ass_path = cap.write_ass(words, base / "captions.ass")
    _words_to_srt(words, base / "captions.srt")

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

    try:
        keyframe = await thumbnail.pick_keyframe(final, base / "keyframe.jpg")
        thumbnail.render_thumbnail(
            base_frame=keyframe, title=script.title, channel_name=settings.channel_name,
            font_path=settings.thumbnail_font_path, out_path=base / "thumbnail.jpg",
        )
    except Exception:
        log.exception("thumbnail generation failed; falling back to YouTube auto-thumb")

    for aname in settings.render_aspects:
        spec = distribution.ASPECTS.get(aname)
        if spec is None:
            continue
        try:
            await distribution.re_export(final, spec, base)
        except Exception:
            log.exception("re-export failed for aspect=%s", aname)

    distribution.write_platform_metadata(
        out_dir=base, base_title=script.title, description=description, tags=script.tags,
        cta_line=_format_cta(settings.cta_comment_template, video_url=None),
    )
    return base, script


# ---------------------------------------------------------------------------
# Long-form companion
# ---------------------------------------------------------------------------


async def _dispatch_longform(*, dry_run: bool) -> None:
    from shorts.jobs.longform_dispatcher import run as scan

    jobs = await scan()
    if not jobs:
        log.info("no Shorts qualify for long-form right now")
        return
    for job in jobs:
        log.info("running long-form for parent_published_id=%s", job.parent_published_id)
        try:
            await _run_longform(parent_published_id=job.parent_published_id, dry_run=dry_run)
        except Exception:
            log.exception("longform run failed for parent_published_id=%s", job.parent_published_id)


async def _run_longform(*, parent_published_id: int, dry_run: bool) -> None:
    settings = get_settings()
    if not settings.longform_enabled and not dry_run:
        log.warning("LONGFORM_ENABLED=false; refusing to upload. Use --dry-run for tests.")
        return

    Session = get_sessionmaker()
    async with Session() as session:
        parent = await session.get(Published, parent_published_id)
        if parent is None:
            raise RuntimeError(f"parent published_id={parent_published_id} not found")
        cand = await session.get(Candidate, parent.candidate_id)
        if cand is None:
            raise RuntimeError(f"candidate_id={parent.candidate_id} not found")

    today = datetime.now(UTC).strftime("%Y-%m-%d")
    slug = slugify(cand.title)[:60] or cand.source_id
    base = settings.data_dir / "outbox-longform" / ("dry" if dry_run else today) / f"{cand.source_id}-{slug}"
    base.mkdir(parents=True, exist_ok=True)

    writer = ScriptWriter(settings)
    winners = []
    if settings.yt_analytics_enabled:
        async with Session() as session:
            winners = await recent_winners(
                session, locale=cand.locale, min_views=settings.yt_winner_min_views, limit=5
            )
    script = await writer.write(
        locale=cand.locale, source_title=cand.title, source_channel=cand.channel,
        source_url=cand.url, winners=winners, kind="longform",
    )
    description = _inject_affiliates(settings, script.body, cand.title, base_desc=script.description)

    parent_short_url = (
        f"https://www.youtube.com/watch?v={parent.youtube_video_id}"
        if parent.youtube_video_id else ""
    )
    if parent_short_url:
        description = f"{description}\n\nWatch the 30-second version: {parent_short_url}"

    metadata = {
        "title": script.title,
        "description": description,
        "tags": script.tags,
        "locale": cand.locale,
        "kind": "longform",
        "parent_published_id": parent_published_id,
        "chapter_titles": [c.title for c in script.chapters],
        "source": _source_block(cand),
        "fair_use": _fair_use_block(settings),
    }
    (base / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
    (base / "script.txt").write_text(script.body, encoding="utf-8")

    if dry_run:
        log.info("dry-run wrote longform metadata to %s", base)
        return

    vo_path = await _synth_vo(settings, text=script.body, locale=cand.locale, out=base / "vo.wav")
    words = await cap.transcribe(vo_path, whisper_base_url=settings.whisper_base_url)
    ass_path = cap.write_ass(words, base / "captions.ass", chunk_size=3)
    _words_to_srt(words, base / "captions.srt")

    total_duration = words[-1].end if words else 0.0
    timings = lf.chapter_timings(
        [(c.title, c.body) for c in script.chapters],
        words=words,
        total_duration=total_duration,
    )
    chapters_block = lf.format_chapter_block(timings)
    description = description.replace("[CHAPTERS]", chapters_block) if "[CHAPTERS]" in description \
        else f"{description}\n\n{chapters_block}"
    (base / "metadata.json").write_text(
        json.dumps({**metadata, "description": description}, ensure_ascii=False, indent=2)
    )

    bdir = base / "broll"
    bdir.mkdir(exist_ok=True)
    pex = broll_mod.PexelsBRoll(settings.pexels_api_key)
    raw_clips: list[Path] = []
    try:
        for i, chapter in enumerate(script.chapters):
            query = " ".join(chapter.title.split()[:5]) or cand.title
            clips = await pex.search_download(query=query, out_dir=bdir / f"ch{i}", max_results=3)
            raw_clips.extend(clips)
    finally:
        await pex.aclose()
    if not raw_clips:
        raise RuntimeError("no B-roll available for long-form")

    normalized_16x9: list[Path] = []
    for i, p in enumerate(raw_clips):
        normalized_16x9.append(await lf.normalize_to_16x9(p, bdir / f"norm16x9_{i}.mp4", duration=12.0))

    # Up to 3 source cutaways spread along the duration (each ≤8s).
    src_cuts: list[Path] = []
    try:
        src_dl = await clipper.download(cand.url, out_dir=bdir / "src", cache_dir=settings.cache_dir)
        windows = [10.0, max(10.0, total_duration * 0.4), max(10.0, total_duration * 0.7)][:3]
        for i, start in enumerate(windows):
            try:
                clip = await clipper.cut(
                    src_dl, start=start,
                    duration=min(settings.max_source_clip_seconds, 7.0),
                    out_path=bdir / f"src_cut_{i}.mp4",
                    max_seconds=settings.max_source_clip_seconds,
                )
                src_cuts.append(await lf.normalize_to_16x9(clip, bdir / f"src_cut_16x9_{i}.mp4"))
            except Exception:
                log.exception("source cutaway %d failed; continuing", i)
    except Exception:
        log.exception("source download failed; rendering without cutaways")

    broll_paths = src_cuts + normalized_16x9

    final = await lf.compose_longform(
        lf.LongformComposeInputs(
            vo_path=vo_path,
            broll_paths=broll_paths,
            captions_ass=ass_path,
            title_text=script.title,
            attribution_text=f"Source: {cand.channel}",
            timings=timings,
        ),
        out_path=base / "final.mp4",
    )
    log.info("composed long-form %s", final)

    try:
        keyframe = await thumbnail.pick_keyframe(final, base / "keyframe.jpg")
        thumbnail.render_thumbnail(
            base_frame=keyframe, title=script.title, channel_name=settings.channel_name,
            font_path=settings.thumbnail_font_path, out_path=base / "thumbnail.jpg",
        )
    except Exception:
        log.exception("longform thumbnail generation failed")

    from shorts.uploaders.youtube import UploadRequest, YouTubeUploader

    thumb = base / "thumbnail.jpg"
    upload = YouTubeUploader(settings, locale=cand.locale).upload(
        UploadRequest(
            file_path=final,
            title=script.title,
            description=description,
            tags=script.tags,
            category_id=settings.longform_category_id,
            privacy=settings.longform_upload_privacy,
            thumbnail_path=thumb if (settings.upload_custom_thumbnail and thumb.exists()) else None,
            cta_comment=None,
        )
    )
    log.info("uploaded long-form %s", upload.url)

    async with Session() as session:
        session.add(
            Published(
                candidate_id=parent.candidate_id,
                locale=cand.locale,
                kind="longform",
                parent_published_id=parent_published_id,
                title=script.title[:256],
                hook=script.hook[:512] if script.hook else None,
                youtube_video_id=upload.video_id,
                privacy=settings.longform_upload_privacy,
                outbox_path=str(base),
                variants_json={"title_variants": script.title_variants},
                affiliate_count=description.count("/go/") if "/go/" in description else 0,
            )
        )
        await session.commit()


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


async def _synth_vo(settings: Settings, *, text: str, locale: str, out: Path) -> Path:
    from shorts.pipeline.tts import XTTSVoice

    speaker_wav = Path(settings.host_voice_sample_path) if settings.host_voice_sample_path else None
    XTTSVoice(settings.tts_models_dir).synthesize(
        text=text,
        locale=locale,
        out_path=out,
        speaker_wav=speaker_wav if speaker_wav and speaker_wav.exists() else None,
    )
    return out


def _inject_affiliates(settings: Settings, body: str, source_title: str, *, base_desc: str) -> str:
    if not settings.affiliates_yaml_path:
        return base_desc
    rules = load_rules(settings.affiliates_yaml_path, amazon_tag=settings.amazon_tag)
    injector = AffiliateInjector(rules, redirect_domain=settings.link_redirect_domain)
    matches = injector.find(source_title, body)
    block = injector.description_block(matches)
    return f"{base_desc}\n\n{block}" if block else base_desc


def _source_block(cand: Candidate) -> dict:
    return {
        "platform": "youtube",
        "id": cand.source_id,
        "url": cand.url,
        "channel": cand.channel,
        "title": cand.title,
    }


def _fair_use_block(settings: Settings) -> dict:
    return {
        "max_source_clip_seconds": settings.max_source_clip_seconds,
        "source_audio_dropped": True,
        "commentary": True,
    }


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
