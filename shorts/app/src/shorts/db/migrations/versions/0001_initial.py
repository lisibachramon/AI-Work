"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "candidates",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("source_id", sa.String(128), nullable=False),
        sa.Column("locale", sa.String(8), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("channel", sa.String(256), nullable=False),
        sa.Column("url", sa.String(512), nullable=False),
        sa.Column("view_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("velocity", sa.Float, nullable=False, server_default="0"),
        sa.Column("extra", sa.JSON, nullable=False, server_default="{}"),
        sa.Column(
            "discovered_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="new"),
        sa.UniqueConstraint("source", "source_id", name="uq_candidate_source"),
    )
    op.create_index("ix_candidates_locale_status", "candidates", ["locale", "status"])
    op.create_index("ix_candidates_velocity", "candidates", ["velocity"])

    op.create_table(
        "published",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("candidate_id", sa.Integer, nullable=False),
        sa.Column("locale", sa.String(8), nullable=False),
        sa.Column("title", sa.String(256), nullable=False),
        sa.Column("youtube_video_id", sa.String(64), nullable=True),
        sa.Column("privacy", sa.String(16), nullable=False),
        sa.Column("outbox_path", sa.String(512), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_published_created_at", "published", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_published_created_at", "published")
    op.drop_table("published")
    op.drop_index("ix_candidates_velocity", "candidates")
    op.drop_index("ix_candidates_locale_status", "candidates")
    op.drop_table("candidates")
