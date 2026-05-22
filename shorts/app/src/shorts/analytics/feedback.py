"""Pull recent winners from the performance table so the script writer can
learn from what's actually performing on this channel."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shorts.db.models import Performance, Published


@dataclass(slots=True)
class Winner:
    video_id: str
    title: str
    hook: str | None
    views: int
    avg_view_pct: float
    locale: str


async def recent_winners(
    session: AsyncSession,
    *,
    locale: str,
    min_views: int = 5000,
    limit: int = 5,
) -> list[Winner]:
    """Top performers in this locale by total views, optionally weighted by
    retention. Excludes videos with no analytics yet."""
    views_sum = func.sum(Performance.views).label("views_sum")
    retention = func.avg(Performance.avg_view_pct).label("ret")
    q = (
        select(
            Published.youtube_video_id,
            Published.title,
            Published.hook,
            views_sum,
            retention,
            Published.locale,
        )
        .join(Performance, Performance.youtube_video_id == Published.youtube_video_id)
        .where(Published.locale == locale)
        .group_by(
            Published.id,
            Published.youtube_video_id,
            Published.title,
            Published.hook,
            Published.locale,
        )
        .having(views_sum >= min_views)
        .order_by(views_sum.desc())
        .limit(limit)
    )
    rows = (await session.execute(q)).all()
    return [
        Winner(
            video_id=str(r[0]),
            title=str(r[1]),
            hook=(r[2] if r[2] else None),
            views=int(r[3] or 0),
            avg_view_pct=float(r[4] or 0),
            locale=str(r[5]),
        )
        for r in rows
    ]


def format_for_prompt(winners: list[Winner]) -> str:
    """Compact bullets the script writer can include verbatim as few-shot."""
    if not winners:
        return ""
    lines = ["Recent winners on this channel (mirror their voice and structure):"]
    for w in winners:
        retention = f"{w.avg_view_pct:.0f}%" if w.avg_view_pct else "n/a"
        hook = f' — opens: "{w.hook[:80]}"' if w.hook else ""
        lines.append(f"- ({w.views:,} views, {retention} retention) {w.title}{hook}")
    return "\n".join(lines)
