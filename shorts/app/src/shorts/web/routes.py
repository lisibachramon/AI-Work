"""Health + minimal dashboard endpoints."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, BackgroundTasks
from sqlalchemy import desc, select

from shorts.config import get_settings
from shorts.db.models import Candidate, Published, get_sessionmaker
from shorts.jobs.worker import _run as run_worker

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {"ok": True}


@router.get("/health/db")
async def health_db() -> dict:
    Session = get_sessionmaker()
    async with Session() as session:
        await session.execute(select(1))
    return {"ok": True}


@router.get("/health/youtube")
async def health_youtube() -> dict:
    s = get_settings()
    return {"ok": bool(s.youtube_api_key and s.yt_refresh_token)}


@router.get("/health/plex")
async def health_plex() -> dict:
    from shorts.discovery.plex import PlexSampler

    s = get_settings()
    if not (s.plex_base_url and s.plex_token):
        return {"ok": False, "reason": "not configured"}
    try:
        PlexSampler(s.plex_base_url, s.plex_token)._connect()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "reason": str(exc)}


@router.get("/health/whisper")
async def health_whisper() -> dict:
    s = get_settings()
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            r = await client.get(f"{s.whisper_base_url}/")
            return {"ok": r.status_code < 500}
        except Exception as exc:
            return {"ok": False, "reason": str(exc)}


@router.get("/history")
async def history(limit: int = 25) -> list[dict]:
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (
            await session.execute(
                select(Published).order_by(desc(Published.created_at)).limit(limit)
            )
        ).scalars().all()
        return [
            {
                "id": r.id,
                "locale": r.locale,
                "title": r.title,
                "youtube_video_id": r.youtube_video_id,
                "privacy": r.privacy,
                "outbox_path": r.outbox_path,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]


@router.get("/queue")
async def queue(limit: int = 25) -> list[dict]:
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (
            await session.execute(
                select(Candidate)
                .where(Candidate.status == "new")
                .order_by(desc(Candidate.velocity))
                .limit(limit)
            )
        ).scalars().all()
        return [
            {
                "id": r.id,
                "locale": r.locale,
                "title": r.title,
                "channel": r.channel,
                "url": r.url,
                "velocity": r.velocity,
            }
            for r in rows
        ]


@router.post("/jobs/run")
async def jobs_run(locale: str, background: BackgroundTasks, dry_run: bool = False) -> dict:
    background.add_task(run_worker, locale=locale, dry_run=dry_run, limit=1)
    return {"accepted": True, "locale": locale, "dry_run": dry_run}
