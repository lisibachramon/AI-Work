"""longform companion: kind + parent linkage on published

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "published",
        sa.Column("kind", sa.String(16), nullable=False, server_default="short"),
    )
    op.add_column(
        "published",
        sa.Column("parent_published_id", sa.Integer, nullable=True),
    )
    op.create_index("ix_published_kind_candidate", "published", ["kind", "candidate_id"])


def downgrade() -> None:
    op.drop_index("ix_published_kind_candidate", "published")
    op.drop_column("published", "parent_published_id")
    op.drop_column("published", "kind")
