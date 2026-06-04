"""Add cog_ready and tiles_ready flags to projects

Revision ID: e4a8c2f1b9d6
Revises: 7f3a8b9c2d1e
Create Date: 2026-06-04

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "e4a8c2f1b9d6"
down_revision: Union[str, None] = "7f3a8b9c2d1e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "cog_ready",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "tiles_ready",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "tiles_ready")
    op.drop_column("projects", "cog_ready")
