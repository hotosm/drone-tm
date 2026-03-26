"""fix latest schema 2026.1.0

Revision ID: a003df57e169
Revises: add_thumbnail_url
Create Date: 2026-03-24 01:33:35.483759

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a003df57e169"
down_revision: Union[str, None] = "add_thumbnail_url"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction in PostgreSQL.
    op.execute("COMMIT")
    for value in ("uploaded", "classifying", "assigned", "rejected"):
        op.execute(f"ALTER TYPE image_status ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # PostgreSQL does not support removing values from an enum type.
    pass
