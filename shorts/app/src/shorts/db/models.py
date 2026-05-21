"""SQLAlchemy models. The schema is small: a candidate queue and a published log."""

from __future__ import annotations

from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy import JSON, DateTime, Float, Integer, String, UniqueConstraint
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from shorts.config import get_settings


class Base(DeclarativeBase):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


class Candidate(Base):
    """A discovered trending item. One row per (source, source_id)."""

    __tablename__ = "candidates"
    __table_args__ = (UniqueConstraint("source", "source_id", name="uq_candidate_source"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(32))  # "youtube" | "tiktok"
    source_id: Mapped[str] = mapped_column(String(128))
    locale: Mapped[str] = mapped_column(String(8))
    title: Mapped[str] = mapped_column(String(512))
    channel: Mapped[str] = mapped_column(String(256))
    url: Mapped[str] = mapped_column(String(512))
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    velocity: Mapped[float] = mapped_column(Float, default=0.0)  # views per hour
    extra: Mapped[dict] = mapped_column(JSON, default=dict)

    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    status: Mapped[str] = mapped_column(String(16), default="new")  # new|skipped|processed


class Published(Base):
    """Record of a rendered + uploaded short."""

    __tablename__ = "published"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    candidate_id: Mapped[int] = mapped_column(Integer)
    locale: Mapped[str] = mapped_column(String(8))
    title: Mapped[str] = mapped_column(String(256))
    youtube_video_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    privacy: Mapped[str] = mapped_column(String(16))
    outbox_path: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


@lru_cache
def get_engine() -> AsyncEngine:
    return create_async_engine(get_settings().database_url, future=True)


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False)
