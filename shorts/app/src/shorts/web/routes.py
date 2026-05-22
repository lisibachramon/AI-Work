"""Health + minimal dashboard endpoints."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import desc, func, select

from shorts.config import get_settings
from shorts.db.models import Affiliate, Candidate, Performance, Published, get_sessionmaker
from shorts.jobs.analytics_sync import run as analytics_run
from shorts.jobs.longform_dispatcher import find_qualifying_shorts
from shorts.jobs.worker import _dispatch_longform, _run_longform
from shorts.jobs.worker import _run as run_worker
from shorts.monetization import AffiliateInjector, load_rules

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
async def history(limit: int = 25, kind: str | None = None) -> list[dict]:
    Session = get_sessionmaker()
    async with Session() as session:
        q = select(Published).order_by(desc(Published.created_at)).limit(limit)
        if kind:
            q = q.where(Published.kind == kind)
        rows = (await session.execute(q)).scalars().all()
        return [
            {
                "id": r.id,
                "locale": r.locale,
                "kind": r.kind,
                "parent_published_id": r.parent_published_id,
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
                "rising_score": r.extra.get("rising_score") if isinstance(r.extra, dict) else None,
                "rising_source": r.extra.get("rising_source") if isinstance(r.extra, dict) else None,
            }
            for r in rows
        ]


@router.post("/jobs/run")
async def jobs_run(locale: str, background: BackgroundTasks, dry_run: bool = False) -> dict:
    background.add_task(run_worker, locale=locale, dry_run=dry_run, limit=1)
    return {"accepted": True, "locale": locale, "dry_run": dry_run}


@router.post("/jobs/analytics-sync")
async def jobs_analytics_sync(background: BackgroundTasks) -> dict:
    background.add_task(analytics_run)
    return {"accepted": True}


@router.get("/longform/candidates")
async def longform_candidates() -> list[dict]:
    """Shorts that currently qualify for a long-form companion render."""
    Session = get_sessionmaker()
    async with Session() as session:
        jobs = await find_qualifying_shorts(session)
    return [
        {
            "parent_published_id": j.parent_published_id,
            "candidate_id": j.candidate_id,
            "locale": j.locale,
            "total_views": j.total_views,
        }
        for j in jobs
    ]


@router.post("/longform/run")
async def longform_run(
    background: BackgroundTasks, published_id: int, dry_run: bool = False
) -> dict:
    """Render the long-form for a specific Short. Async — returns 202 immediately."""
    background.add_task(_run_longform, parent_published_id=published_id, dry_run=dry_run)
    return {"accepted": True, "parent_published_id": published_id, "dry_run": dry_run}


@router.post("/longform/dispatch")
async def longform_dispatch(background: BackgroundTasks, dry_run: bool = False) -> dict:
    """Run the scan-and-queue scheduler step on demand."""
    background.add_task(_dispatch_longform, dry_run=dry_run)
    return {"accepted": True, "dry_run": dry_run}


@router.get("/revenue")
async def revenue(days: int = 30) -> dict:
    """Aggregate per-locale revenue for the last `days` days."""
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (
            await session.execute(
                select(
                    Published.locale,
                    func.sum(Performance.views).label("views"),
                    func.sum(Performance.subscribers_gained).label("subs"),
                    func.sum(Performance.estimated_revenue_usd).label("revenue"),
                    func.count(func.distinct(Published.id)).label("uploads"),
                )
                .join(Performance, Performance.youtube_video_id == Published.youtube_video_id)
                .group_by(Published.locale)
            )
        ).all()
        clicks = (
            await session.execute(
                select(Affiliate.slug, func.count(Affiliate.id)).group_by(Affiliate.slug)
            )
        ).all()
    return {
        "by_locale": [
            {
                "locale": r[0],
                "views": int(r[1] or 0),
                "subscribers": int(r[2] or 0),
                "estimated_revenue_usd": float(r[3] or 0),
                "uploads": int(r[4] or 0),
            }
            for r in rows
        ],
        "affiliate_clicks": {row[0]: int(row[1]) for row in clicks},
        "window_days": days,
    }


@router.get("/go/{slug}")
async def go(slug: str, request: Request) -> RedirectResponse:
    """Affiliate redirect — logs the click then 302s to the destination."""
    s = get_settings()
    if not s.affiliates_yaml_path:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="no affiliates configured")
    rules = load_rules(s.affiliates_yaml_path, amazon_tag=s.amazon_tag)
    injector = AffiliateInjector(rules, redirect_domain=s.link_redirect_domain)
    target = next((r.url for r in injector.rules if r.slug == slug), None)
    if not target:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="unknown slug")
    Session = get_sessionmaker()
    async with Session() as session:
        session.add(
            Affiliate(
                slug=slug,
                target_url=target,
                referrer=request.headers.get("referer"),
                user_agent=request.headers.get("user-agent"),
            )
        )
        await session.commit()
    return RedirectResponse(target, status_code=302)
