"""revenue features: variants, performance, affiliate clicks

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("published", sa.Column("hook", sa.String(512), nullable=True))
    op.add_column(
        "published",
        sa.Column("variants_json", sa.JSON, nullable=False, server_default="{}"),
    )
    op.add_column(
        "published",
        sa.Column("affiliate_count", sa.Integer, nullable=False, server_default="0"),
    )

    op.create_table(
        "performance",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("youtube_video_id", sa.String(64), nullable=False),
        sa.Column("day", sa.String(10), nullable=False),
        sa.Column("views", sa.Integer, nullable=False, server_default="0"),
        sa.Column("avg_view_duration_s", sa.Float, nullable=False, server_default="0"),
        sa.Column("avg_view_pct", sa.Float, nullable=False, server_default="0"),
        sa.Column("likes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("comments", sa.Integer, nullable=False, server_default="0"),
        sa.Column("shares", sa.Integer, nullable=False, server_default="0"),
        sa.Column("subscribers_gained", sa.Integer, nullable=False, server_default="0"),
        sa.Column("estimated_revenue_usd", sa.Float, nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("youtube_video_id", "day", name="uq_perf_video_day"),
    )
    op.create_index("ix_perf_video", "performance", ["youtube_video_id"])
    op.create_index("ix_perf_day", "performance", ["day"])

    op.create_table(
        "affiliate_clicks",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("target_url", sa.String(1024), nullable=False),
        sa.Column("published_id", sa.Integer, nullable=True),
        sa.Column("referrer", sa.String(256), nullable=True),
        sa.Column("user_agent", sa.String(256), nullable=True),
        sa.Column(
            "clicked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_clicks_slug", "affiliate_clicks", ["slug"])


def downgrade() -> None:
    op.drop_index("ix_clicks_slug", "affiliate_clicks")
    op.drop_table("affiliate_clicks")
    op.drop_index("ix_perf_day", "performance")
    op.drop_index("ix_perf_video", "performance")
    op.drop_table("performance")
    op.drop_column("published", "affiliate_count")
    op.drop_column("published", "variants_json")
    op.drop_column("published", "hook")
