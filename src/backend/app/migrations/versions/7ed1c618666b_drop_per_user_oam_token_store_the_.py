"""Drop per-user OAM token and store the published item.

Revision ID: 7ed1c618666b
Revises: a55b375601fc
Create Date: 2026-08-27 06:55:21.655881

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7ed1c618666b"
down_revision: str | None = "a55b375601fc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("oam_item_id", sa.String(), nullable=True))
    op.drop_column("user_profile", "oam_api_token")


def downgrade() -> None:
    op.add_column(
        "user_profile",
        sa.Column("oam_api_token", sa.VARCHAR(), autoincrement=False, nullable=True),
    )
    op.drop_column("projects", "oam_item_id")
